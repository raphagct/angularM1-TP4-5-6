import test, { describe, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { createApp } from "../src/app.js";
import { User } from "../src/models/User.js";
import { Track } from "../src/models/Track.js";
import { silentMp3, withId3, TINY_PNG } from "./helpers/audio.js";

/*
 * Ces tests démarrent la vraie application Express sur un port aléatoire,
 * mais remplacent les méthodes Mongoose par des simulations (mock.method) :
 * aucune base MongoDB n'est nécessaire. Les fichiers sont écrits dans un
 * dossier temporaire grâce à createApp({ uploadsDir }).
 */

const SECRET = process.env.JWT_SECRET || "tp1-development-secret";
const userId = new mongoose.Types.ObjectId().toString();
const trackId = new mongoose.Types.ObjectId().toString();
const bearer = (sub = userId) => ({
  Authorization: `Bearer ${jwt.sign({ sub, email: "u@test.dev" }, SECRET, { expiresIn: "1h" })}`,
});

let server, base, uploadsDir, coversDir;

/** Simule une requête Mongoose chaînable (select, sort, lean...) et awaitable. */
function query(result) {
  const q = {
    then: (resolve, reject) =>
      (result instanceof Error ? Promise.reject(result) : Promise.resolve(result)).then(resolve, reject),
  };
  for (const method of ["select", "sort", "skip", "limit", "lean"]) q[method] = () => q;
  return q;
}

const json = (body) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

async function listFiles(dir) {
  return (await fs.readdir(dir, { withFileTypes: true })).filter((e) => e.isFile()).map((e) => e.name);
}

/** Construit le multipart d'un upload. */
function uploadForm({ audio = silentMp3(), audioType = "audio/mpeg", cover, coverType = "image/png", fields = {} } = {}) {
  const form = new FormData();
  if (audio) form.append("audio", new Blob([audio], { type: audioType }), "song.mp3");
  if (cover) form.append("cover", new Blob([cover], { type: coverType }), "cover.png");
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return form;
}

const post = (form, headers = bearer()) =>
  fetch(base + "/api/tracks", { method: "POST", headers, body: form });

test.before(async () => {
  uploadsDir = await fs.mkdtemp(path.join(os.tmpdir(), "gpc-api-"));
  coversDir = path.join(uploadsDir, "covers");
  server = createApp({ uploadsDir }).listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  server.close();
  await fs.rm(uploadsDir, { recursive: true, force: true });
});

test.afterEach(() => mock.restoreAll());

test("health sans dépendre de MongoDB", async () => {
  const r = await fetch(base + "/api/health");
  assert.equal(r.status, 200);
  assert.equal((await r.json()).status, "ok");
});

test("createApp crée le dossier des pochettes", async () => {
  assert.ok((await fs.stat(coversDir)).isDirectory());
});

describe("middleware auth", () => {
  test("401 sans en-tête Authorization", async () => {
    const r = await fetch(base + "/api/users/me");
    assert.equal(r.status, 401);
    assert.equal((await r.json()).message, "Authentification requise");
  });

  test("401 sans le préfixe Bearer", async () => {
    const r = await fetch(base + "/api/users/me", { headers: { Authorization: "Token abc" } });
    assert.equal(r.status, 401);
  });

  test("401 avec un token signé par un autre secret", async () => {
    const forged = jwt.sign({ sub: userId }, "autre-secret");
    const r = await fetch(base + "/api/users/me", { headers: { Authorization: `Bearer ${forged}` } });
    assert.equal(r.status, 401);
    assert.equal((await r.json()).message, "Jeton invalide ou expiré");
  });

  test("401 avec un token expiré", async () => {
    const expired = jwt.sign({ sub: userId, exp: Math.floor(Date.now() / 1000) - 10 }, SECRET);
    const r = await fetch(base + "/api/users/me", { headers: { Authorization: `Bearer ${expired}` } });
    assert.equal(r.status, 401);
  });
});

describe("POST /api/auth/register", () => {
  test("400 si un champ manque ou si le mot de passe est trop court", async () => {
    for (const body of [{}, { name: "A", email: "a@b.c" }, { name: "Ann", email: "a@b.c", password: "short" }]) {
      const r = await fetch(base + "/api/auth/register", json(body));
      assert.equal(r.status, 400);
    }
  });

  test("409 si l'email existe déjà (recherche en minuscules)", async () => {
    const exists = mock.method(User, "exists", async () => ({ _id: userId }));
    const r = await fetch(base + "/api/auth/register", json({ name: "Ann", email: "ANN@x.io", password: "12345678" }));
    assert.equal(r.status, 409);
    assert.deepEqual(exists.mock.calls[0].arguments[0], { email: "ann@x.io" });
  });

  test("201 avec un token valide et l'utilisateur public", async () => {
    mock.method(User, "exists", async () => null);
    mock.method(User, "create", async (data) => new User(data));
    const r = await fetch(base + "/api/auth/register", json({ name: "Ann", email: "ann@x.io", password: "12345678" }));
    assert.equal(r.status, 201);
    const body = await r.json();
    assert.equal(body.user.email, "ann@x.io");
    assert.equal(body.user.passwordHash, undefined);
    assert.equal(jwt.verify(body.token, SECRET).sub, body.user.id);
  });
});

describe("POST /api/auth/login", () => {
  const storedUser = async () => {
    const user = new User({ name: "Ann", email: "ann@x.io" });
    user.passwordHash = await bcrypt.hash("12345678", 4);
    return user;
  };

  test("200 avec de bons identifiants", async () => {
    const user = await storedUser();
    const findOne = mock.method(User, "findOne", () => query(user));
    const r = await fetch(base + "/api/auth/login", json({ email: "ANN@x.io", password: "12345678" }));
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.user.id, user.id);
    assert.ok(body.token);
    assert.deepEqual(findOne.mock.calls[0].arguments[0], { email: "ann@x.io" });
  });

  test("401 avec un mauvais mot de passe", async () => {
    const user = await storedUser();
    mock.method(User, "findOne", () => query(user));
    const r = await fetch(base + "/api/auth/login", json({ email: "ann@x.io", password: "mauvais!" }));
    assert.equal(r.status, 401);
  });

  test("401 pour un utilisateur inconnu", async () => {
    mock.method(User, "findOne", () => query(null));
    const r = await fetch(base + "/api/auth/login", json({ email: "nobody@x.io", password: "12345678" }));
    assert.equal(r.status, 401);
    assert.equal((await r.json()).message, "Identifiants incorrects");
  });
});

describe("/api/users/me", () => {
  test("GET renvoie le profil de l'utilisateur du token", async () => {
    const user = new User({ _id: userId, name: "Ann", email: "ann@x.io" });
    const findById = mock.method(User, "findById", async () => user);
    const r = await fetch(base + "/api/users/me", { headers: bearer() });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).name, "Ann");
    assert.equal(findById.mock.calls[0].arguments[0], userId);
  });

  test("GET 404 si l'utilisateur n'existe plus", async () => {
    mock.method(User, "findById", async () => null);
    const r = await fetch(base + "/api/users/me", { headers: bearer() });
    assert.equal(r.status, 404);
  });

  test("PUT ne modifie que le nom", async () => {
    const update = mock.method(User, "findByIdAndUpdate", async (_id, change) =>
      new User({ _id: userId, name: change.$set.name, email: "ann@x.io" }),
    );
    const r = await fetch(base + "/api/users/me", {
      method: "PUT",
      headers: { ...bearer(), "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Bob", email: "hack@x.io" }),
    });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).name, "Bob");
    assert.deepEqual(update.mock.calls[0].arguments[1], { $set: { name: "Bob" } });
  });

  test("PUT 400 si la validation Mongoose échoue", async () => {
    mock.method(User, "findByIdAndUpdate", async () => {
      throw new mongoose.Error.ValidationError();
    });
    const r = await fetch(base + "/api/users/me", {
      method: "PUT",
      headers: { ...bearer(), "Content-Type": "application/json" },
      body: JSON.stringify({ name: "" }),
    });
    assert.equal(r.status, 400);
  });
});

describe("GET /api/tracks", () => {
  const lean = (title) => ({
    _id: new mongoose.Types.ObjectId(),
    ownerId: userId,
    title,
    originalName: `${title}.mp3`,
    mimeType: "audio/mpeg",
    size: 1,
    coverMimeType: title === "A" ? "image/png" : undefined,
  });

  test("renvoie une page filtrée sur le propriétaire, au format public", async () => {
    const find = mock.method(Track, "find", () => query([lean("A"), lean("B")]));
    const count = mock.method(Track, "countDocuments", async () => 7);
    const r = await fetch(base + "/api/tracks?page=2&limit=2", { headers: bearer() });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.page, 2);
    assert.equal(body.limit, 2);
    assert.equal(body.total, 7);
    assert.equal(body.pages, 4);
    assert.equal(body.items[0].hasCover, true);
    assert.equal(body.items[1].hasCover, false);
    assert.equal(body.items[0]._id, undefined);
    assert.equal(typeof body.items[0].id, "string");
    assert.deepEqual(find.mock.calls[0].arguments[0], { ownerId: userId });
    assert.deepEqual(count.mock.calls[0].arguments[0], { ownerId: userId });
  });

  test("borne page et limit (défaut 1 / 5, maximum 20)", async () => {
    mock.method(Track, "find", () => query([]));
    mock.method(Track, "countDocuments", async () => 0);

    let body = await (await fetch(base + "/api/tracks?page=-3&limit=abc", { headers: bearer() })).json();
    assert.equal(body.page, 1);
    assert.equal(body.limit, 5);
    assert.equal(body.pages, 1);

    body = await (await fetch(base + "/api/tracks?limit=500", { headers: bearer() })).json();
    assert.equal(body.limit, 20);
  });
});

describe("POST /api/tracks", () => {
  test("401 sans token", async () => {
    const r = await post(uploadForm(), {});
    assert.equal(r.status, 401);
  });

  test("400 sans fichier audio, et la pochette seule est supprimée", async () => {
    const r = await post(uploadForm({ audio: null, cover: TINY_PNG }));
    assert.equal(r.status, 400);
    assert.equal((await r.json()).message, "Fichier audio requis");
    assert.deepEqual(await listFiles(coversDir), []);
  });

  test("400 pour un format audio refusé", async () => {
    const r = await post(uploadForm({ audioType: "text/plain" }));
    assert.equal(r.status, 400);
    assert.equal((await r.json()).message, "Format audio non accepté");
  });

  test("400 pour un format de pochette refusé", async () => {
    const r = await post(uploadForm({ cover: Buffer.from("gif"), coverType: "image/gif" }));
    assert.equal(r.status, 400);
    assert.equal((await r.json()).message, "Format d'image non accepté");
  });

  test("400 si la pochette dépasse 5 Mo et les fichiers sont nettoyés", async () => {
    const before = await listFiles(uploadsDir);
    const r = await post(uploadForm({ cover: Buffer.alloc(5 * 1024 * 1024 + 1) }));
    assert.equal(r.status, 400);
    assert.deepEqual(await listFiles(uploadsDir), before);
    assert.deepEqual(await listFiles(coversDir), []);
  });

  test("201 : lit les tags ID3 et extrait la pochette intégrée", async () => {
    const create = mock.method(Track, "create", async (data) => new Track(data));
    const audio = withId3(silentMp3(), {
      title: "Tag Title",
      artist: "Tag Artist",
      album: "Tag Album",
      genre: "Funk",
      year: 1987,
      picture: { mime: "image/png", data: TINY_PNG },
    });

    const r = await post(uploadForm({ audio }));
    assert.equal(r.status, 201);
    const body = await r.json();
    assert.equal(body.title, "Tag Title");
    assert.equal(body.artist, "Tag Artist");
    assert.equal(body.album, "Tag Album");
    assert.equal(body.genre, "Funk");
    assert.equal(body.year, 1987);
    assert.equal(body.hasCover, true);
    assert.ok(body.duration > 0);
    assert.equal(body.sampleRate, 44100);
    assert.equal(body.coverStoredName, undefined);

    const saved = create.mock.calls[0].arguments[0];
    assert.equal(saved.ownerId, userId);
    assert.equal(saved.coverMimeType, "image/png");
    assert.deepEqual(await fs.readFile(path.join(coversDir, saved.coverStoredName)), TINY_PNG);
    assert.ok(await fs.stat(path.join(uploadsDir, saved.storedName)));
  });

  test("201 : les champs saisis et la pochette envoyée sont prioritaires sur les tags", async () => {
    const create = mock.method(Track, "create", async (data) => new Track(data));
    const audio = withId3(silentMp3(), {
      title: "Tag Title",
      artist: "Tag Artist",
      picture: { mime: "image/png", data: Buffer.from("embedded") },
    });

    const r = await post(
      uploadForm({
        audio,
        cover: TINY_PNG,
        fields: { title: "Mon titre", artist: " Moi ", album: "", genre: "Blues" },
      }),
    );
    assert.equal(r.status, 201);
    const body = await r.json();
    assert.equal(body.title, "Mon titre");
    assert.equal(body.artist, "Moi");
    assert.equal(body.genre, "Blues");

    const saved = create.mock.calls[0].arguments[0];
    assert.match(saved.coverStoredName, /\.png$/);
    assert.deepEqual(await fs.readFile(path.join(coversDir, saved.coverStoredName)), TINY_PNG);
  });

  test("201 : sans titre ni tag, le nom du fichier est utilisé", async () => {
    mock.method(Track, "create", async (data) => new Track(data));
    const r = await post(uploadForm());
    const body = await r.json();
    assert.equal(r.status, 201);
    assert.equal(body.title, "song.mp3");
    assert.equal(body.artist, undefined);
    assert.equal(body.hasCover, false);
  });

  test("si MongoDB échoue, l'audio et la pochette sont supprimés du disque", async () => {
    mock.method(Track, "create", async () => {
      throw new Error("Mongo down");
    });
    const audioBefore = await listFiles(uploadsDir);
    const coversBefore = await listFiles(coversDir);
    const audio = withId3(silentMp3(), { picture: { mime: "image/png", data: TINY_PNG } });

    const r = await post(uploadForm({ audio }));
    assert.equal(r.status, 500);
    assert.deepEqual(await listFiles(uploadsDir), audioBefore);
    assert.deepEqual(await listFiles(coversDir), coversBefore);
  });
});

describe("GET /api/tracks/:id", () => {
  test("404 pour un identifiant mal formé, sans requête MongoDB", async () => {
    const findOne = mock.method(Track, "findOne", () => query(null));
    const r = await fetch(base + "/api/tracks/pas-un-id", { headers: bearer() });
    assert.equal(r.status, 404);
    assert.equal(findOne.mock.callCount(), 0);
  });

  test("404 si la piste n'appartient pas à l'utilisateur", async () => {
    const findOne = mock.method(Track, "findOne", () => query(null));
    const r = await fetch(`${base}/api/tracks/${trackId}`, { headers: bearer() });
    assert.equal(r.status, 404);
    assert.deepEqual(findOne.mock.calls[0].arguments[0], { _id: trackId, ownerId: userId });
  });

  test("200 avec les métadonnées publiques", async () => {
    const track = new Track({
      _id: trackId,
      ownerId: userId,
      title: "One",
      artist: "Someone",
      originalName: "one.mp3",
      storedName: "secret.mp3",
      mimeType: "audio/mpeg",
      size: 10,
      duration: 61,
    });
    mock.method(Track, "findOne", () => query(track));
    const r = await fetch(`${base}/api/tracks/${trackId}`, { headers: bearer() });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.id, trackId);
    assert.equal(body.artist, "Someone");
    assert.equal(body.duration, 61);
    assert.equal(body.storedName, undefined);
  });
});

describe("GET /api/tracks/:id/cover", () => {
  test("404 si la piste est inconnue", async () => {
    mock.method(Track, "findOne", () => query(null));
    const r = await fetch(`${base}/api/tracks/${trackId}/cover`, { headers: bearer() });
    assert.equal(r.status, 404);
    assert.equal((await r.json()).message, "Piste inconnue");
  });

  test("404 si la piste n'a pas de pochette", async () => {
    mock.method(Track, "findOne", () => query({ id: trackId }));
    const r = await fetch(`${base}/api/tracks/${trackId}/cover`, { headers: bearer() });
    assert.equal(r.status, 404);
    assert.equal((await r.json()).message, "Pochette absente");
  });

  test("200 avec l'image et son type MIME", async () => {
    await fs.writeFile(path.join(coversDir, "c.png"), TINY_PNG);
    mock.method(Track, "findOne", () => query({ id: trackId, coverStoredName: "c.png", coverMimeType: "image/png" }));
    const r = await fetch(`${base}/api/tracks/${trackId}/cover`, { headers: bearer() });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("content-type"), "image/png");
    assert.match(r.headers.get("cache-control"), /private/);
    assert.deepEqual(Buffer.from(await r.arrayBuffer()), TINY_PNG);
    await fs.rm(path.join(coversDir, "c.png"));
  });

  test("401 sans token", async () => {
    const r = await fetch(`${base}/api/tracks/${trackId}/cover`);
    assert.equal(r.status, 401);
  });
});

describe("GET /api/tracks/:id/audio", () => {
  test("200 avec le flux audio", async () => {
    const audio = silentMp3(4);
    await fs.writeFile(path.join(uploadsDir, "a.mp3"), audio);
    mock.method(Track, "findOne", () => query({ id: trackId, storedName: "a.mp3", mimeType: "audio/mpeg" }));
    const r = await fetch(`${base}/api/tracks/${trackId}/audio`, { headers: bearer() });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("content-type"), "audio/mpeg");
    assert.deepEqual(Buffer.from(await r.arrayBuffer()), audio);
  });

  test("206 pour une requête Range (lecture partielle)", async () => {
    await fs.writeFile(path.join(uploadsDir, "a.mp3"), silentMp3(4));
    mock.method(Track, "findOne", () => query({ id: trackId, storedName: "a.mp3", mimeType: "audio/mpeg" }));
    const r = await fetch(`${base}/api/tracks/${trackId}/audio`, { headers: { ...bearer(), Range: "bytes=0-9" } });
    assert.equal(r.status, 206);
    assert.equal((await r.arrayBuffer()).byteLength, 10);
  });

  test("404 si la piste est inconnue", async () => {
    mock.method(Track, "findOne", () => query(null));
    const r = await fetch(`${base}/api/tracks/${trackId}/audio`, { headers: bearer() });
    assert.equal(r.status, 404);
  });
});

describe("DELETE /api/tracks/:id", () => {
  test("204 et suppression de l'audio et de la pochette", async () => {
    await fs.writeFile(path.join(uploadsDir, "del.mp3"), "x");
    await fs.writeFile(path.join(coversDir, "del.png"), "x");
    const remove = mock.method(Track, "findOneAndDelete", () =>
      query({ id: trackId, storedName: "del.mp3", coverStoredName: "del.png" }),
    );

    const r = await fetch(`${base}/api/tracks/${trackId}`, { method: "DELETE", headers: bearer() });
    assert.equal(r.status, 204);
    assert.deepEqual(remove.mock.calls[0].arguments[0], { _id: trackId, ownerId: userId });
    await assert.rejects(fs.stat(path.join(uploadsDir, "del.mp3")));
    await assert.rejects(fs.stat(path.join(coversDir, "del.png")));
  });

  test("500 si le fichier audio ne peut pas être supprimé", async () => {
    mock.method(Track, "findOneAndDelete", () => query({ id: trackId, storedName: "absent.mp3" }));
    const r = await fetch(`${base}/api/tracks/${trackId}`, { method: "DELETE", headers: bearer() });
    assert.equal(r.status, 500);
  });

  test("404 si la piste est inconnue ou l'identifiant invalide", async () => {
    mock.method(Track, "findOneAndDelete", () => query(null));
    let r = await fetch(`${base}/api/tracks/${trackId}`, { method: "DELETE", headers: bearer() });
    assert.equal(r.status, 404);
    r = await fetch(`${base}/api/tracks/nope`, { method: "DELETE", headers: bearer() });
    assert.equal(r.status, 404);
  });
});
