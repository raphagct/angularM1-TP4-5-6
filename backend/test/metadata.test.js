import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  extractMetadata,
  normalizeImageMime,
  normalizeMetadata,
  pickText,
  saveEmbeddedCover,
} from "../src/metadata.js";
import { silentMp3, withId3, TINY_PNG } from "./helpers/audio.js";

describe("normalizeImageMime", () => {
  test("accepte les types MIME connus", () => {
    assert.equal(normalizeImageMime("image/png"), "image/png");
    assert.equal(normalizeImageMime("image/webp"), "image/webp");
  });

  test("corrige les variantes jpg", () => {
    assert.equal(normalizeImageMime("jpg"), "image/jpeg");
    assert.equal(normalizeImageMime("image/jpg"), "image/jpeg");
    assert.equal(normalizeImageMime("JPEG"), "image/jpeg");
  });

  test("refuse un type inconnu ou absent", () => {
    assert.equal(normalizeImageMime("image/bmp"), null);
    assert.equal(normalizeImageMime(undefined), null);
    assert.equal(normalizeImageMime(""), null);
  });
});

describe("pickText", () => {
  test("retourne la première chaîne non vide, sans espaces", () => {
    assert.equal(pickText("", "  ", " Blues ", "Rock"), "Blues");
  });

  test("ignore les valeurs qui ne sont pas des chaînes", () => {
    assert.equal(pickText(undefined, null, 42, "ok"), "ok");
  });

  test("retourne undefined si rien n'est exploitable", () => {
    assert.equal(pickText(undefined, ""), undefined);
  });
});

describe("normalizeMetadata", () => {
  test("extrait les tags et les infos techniques", () => {
    const result = normalizeMetadata({
      common: {
        title: "Song",
        artist: "Artist",
        album: "Album",
        genre: ["", "Jazz"],
        year: 1999,
        picture: [{ format: "image/jpg", data: Buffer.from([1, 2]) }],
      },
      format: { duration: 12.5, bitrate: 128000, sampleRate: 44100 },
    });

    assert.deepEqual(result, {
      title: "Song",
      artist: "Artist",
      album: "Album",
      genre: "Jazz",
      year: 1999,
      duration: 12.5,
      bitrate: 128000,
      sampleRate: 44100,
      picture: { data: Buffer.from([1, 2]), mimeType: "image/jpeg" },
    });
  });

  test("utilise albumartist si artist est absent", () => {
    assert.equal(normalizeMetadata({ common: { albumartist: "Band" } }).artist, "Band");
  });

  test("ignore une pochette vide ou d'un format inconnu", () => {
    assert.equal(
      normalizeMetadata({ common: { picture: [{ format: "image/png", data: Buffer.alloc(0) }] } }).picture,
      null,
    );
    assert.equal(
      normalizeMetadata({ common: { picture: [{ format: "image/bmp", data: Buffer.from([1]) }] } }).picture,
      null,
    );
  });

  test("ignore les nombres invalides", () => {
    const result = normalizeMetadata({
      common: { year: 19.5 },
      format: { duration: NaN, bitrate: -1, sampleRate: 0 },
    });
    assert.equal(result.year, undefined);
    assert.equal(result.duration, undefined);
    assert.equal(result.bitrate, undefined);
    assert.equal(result.sampleRate, undefined);
  });

  test("supporte une entrée nulle", () => {
    const result = normalizeMetadata(null);
    assert.equal(result.title, undefined);
    assert.equal(result.picture, null);
  });
});

describe("extractMetadata", () => {
  test("utilise le parser injecté", async () => {
    const result = await extractMetadata("/fake.mp3", async (file) => {
      assert.equal(file, "/fake.mp3");
      return { common: { title: "Injected" }, format: {} };
    });
    assert.equal(result.title, "Injected");
  });

  test("retourne un objet vide si le parser échoue", async () => {
    const result = await extractMetadata("/fake.mp3", async () => {
      throw new Error("corrompu");
    });
    assert.equal(result.title, undefined);
    assert.equal(result.picture, null);
  });

  test("lit un vrai fichier MP3 tagué avec music-metadata", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gpc-meta-"));
    const file = path.join(dir, "tagged.mp3");
    await fs.writeFile(
      file,
      withId3(silentMp3(), {
        title: "Tagged",
        artist: "The Testers",
        album: "Fixtures",
        genre: "Rock",
        year: 2024,
        picture: { mime: "image/png", data: TINY_PNG },
      }),
    );

    const result = await extractMetadata(file);
    assert.equal(result.title, "Tagged");
    assert.equal(result.artist, "The Testers");
    assert.equal(result.album, "Fixtures");
    assert.equal(result.genre, "Rock");
    assert.equal(result.year, 2024);
    assert.ok(result.duration > 0.5 && result.duration < 2);
    assert.equal(result.sampleRate, 44100);
    assert.equal(result.picture.mimeType, "image/png");
    assert.deepEqual(Buffer.from(result.picture.data), TINY_PNG);
    await fs.rm(dir, { recursive: true });
  });

  test("lit un MP3 sans tag", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gpc-meta-"));
    const file = path.join(dir, "plain.mp3");
    await fs.writeFile(file, silentMp3());
    const result = await extractMetadata(file);
    assert.equal(result.title, undefined);
    assert.equal(result.picture, null);
    assert.ok(result.duration > 0);
    await fs.rm(dir, { recursive: true });
  });
});

test("saveEmbeddedCover écrit l'image avec un nom aléatoire et la bonne extension", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gpc-cover-"));
  const first = await saveEmbeddedCover(dir, { data: TINY_PNG, mimeType: "image/png" });
  const second = await saveEmbeddedCover(dir, { data: TINY_PNG, mimeType: "image/jpeg" });

  assert.match(first.storedName, /^[0-9a-f-]{36}\.png$/);
  assert.match(second.storedName, /\.jpg$/);
  assert.notEqual(first.storedName, second.storedName);
  assert.equal(first.mimeType, "image/png");
  assert.deepEqual(await fs.readFile(path.join(dir, first.storedName)), TINY_PNG);
  await fs.rm(dir, { recursive: true });
});
