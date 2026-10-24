import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { createDemucsSeparator, demucsArgs } from "../src/separation.js";

/*
 * Ces tests ne lancent pas Python : un faux Demucs écrit en JavaScript est
 * exécuté par Node (process.execPath) avec les mêmes conventions de sortie.
 */

/** Script exécuté à la place de Demucs : son comportement dépend du contenu de l'entrée. */
const FAKE_DEMUCS = `
const fs = require("node:fs");
const path = require("node:path");
const [input, out] = process.argv.slice(1);
const content = fs.readFileSync(input, "utf8");
if (content === "fail") { console.error("modèle introuvable"); process.exit(3); }
if (content === "hang") setInterval(() => {}, 1000);
else {
  fs.mkdirSync(path.join(out, "htdemucs"), { recursive: true });
  fs.writeFileSync(path.join(out, "htdemucs", "vocals.mp3"), "voix de " + content + " " + path.extname(input));
}
`;

/** Garde le dossier temporaire de chaque appel pour vérifier son nettoyage. */
function fakeSeparator(options = {}) {
  const dirs = [];
  const separator = createDemucsSeparator({
    python: process.execPath,
    args: (input, out) => {
      dirs.push(out);
      return ["-e", FAKE_DEMUCS, input, out];
    },
    ...options,
  });
  return { separator, dirs };
}

describe("demucsArgs", () => {
  test("ne garde que la voix, en MP3 192 kbps, avec un nom de sortie fixe", () => {
    const args = demucsArgs("in.mp3", "out");
    assert.deepEqual(args.slice(0, 2), ["-m", "demucs"]);
    assert.equal(args[args.indexOf("--two-stems") + 1], "vocals");
    assert.equal(args[args.indexOf("--other-method") + 1], "none");
    assert.equal(args[args.indexOf("--mp3-bitrate") + 1], "192");
    assert.equal(args[args.indexOf("-o") + 1], "out");
    assert.equal(args[args.indexOf("--filename") + 1], "{stem}.{ext}");
    assert.equal(args.at(-1), "in.mp3");
  });
});

describe("createDemucsSeparator", () => {
  test("retourne la voix écrite par Demucs et supprime le dossier temporaire", async () => {
    const { separator, dirs } = fakeSeparator();
    const vocals = await separator.vocals(Buffer.from("song"), "audio/wav");
    assert.equal(vocals.toString(), "voix de song .wav");
    assert.equal(existsSync(dirs[0]), false);
  });

  test("utilise .mp3 pour un type inconnu", async () => {
    const { separator } = fakeSeparator();
    const vocals = await separator.vocals(Buffer.from("song"), "audio/inconnu");
    assert.equal(path.extname(vocals.toString()), ".mp3");
  });

  test("rejette avec la sortie d'erreur de Demucs et nettoie quand même", async () => {
    const { separator, dirs } = fakeSeparator();
    await assert.rejects(separator.vocals(Buffer.from("fail"), "audio/mpeg"), /code 3.*modèle introuvable/s);
    assert.equal(existsSync(dirs[0]), false);
  });

  test("rejette si Python est introuvable", async () => {
    const separator = createDemucsSeparator({ python: "commande-qui-n-existe-pas" });
    await assert.rejects(separator.vocals(Buffer.from("x"), "audio/mpeg"), /Impossible de lancer/);
  });

  test("arrête un Demucs trop long", async () => {
    const { separator } = fakeSeparator({ timeout: 300 });
    await assert.rejects(separator.vocals(Buffer.from("hang"), "audio/mpeg"), /Demucs a échoué/);
  });

  test("exécute les séparations une par une, même après un échec", async () => {
    const { separator, dirs } = fakeSeparator();
    const first = separator.vocals(Buffer.from("fail"), "audio/mpeg");
    const second = separator.vocals(Buffer.from("b"), "audio/mpeg");
    // La seconde n'a pas encore démarré tant que la première tourne.
    await new Promise((r) => setTimeout(r, 20));
    assert.ok(dirs.length <= 1);
    await assert.rejects(first);
    assert.equal((await second).toString(), "voix de b .mp3");
  });
});
