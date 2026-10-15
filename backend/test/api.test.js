import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { createApp } from "../src/app.js";
import { User } from "../src/models/User.js";
import { Track } from "../src/models/Track.js";

let server, base;

test.before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => server.close());

test("health sans dépendre de MongoDB", async () => {
  const r = await fetch(base + "/api/health");
  assert.equal(r.status, 200);
  assert.equal((await r.json()).status, "ok");
});

test("schémas Mongoose et relation", () => {
  const u = new User({
    name: "Test",
    email: "TEST@example.com",
    password: "12345678",
  });

  assert.equal(u.email, "test@example.com");
  const t = new Track({
    ownerId: new mongoose.Types.ObjectId(),
    title: "Blues",
    originalName: "b.mp3",
    storedName: "x.mp3",
    mimeType: "audio/mpeg",
    size: 42,
  });
  
  assert.equal(t.title, "Blues");
  assert.equal(Track.schema.path("ownerId").options.ref, "User");
});


test("configuration Google publique sans secret", async () => {
  const r = await fetch(base + "/api/auth/google/config");
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.ok(body.clientId === null || typeof body.clientId === "string");
  assert.deepEqual(Object.keys(body), ["clientId"]);
});

test("lien magique mal formé rejeté sans accès MongoDB", async () => {
  const r = await fetch(base + "/api/auth/magic/verify", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: "invalid" }),
  });
  assert.equal(r.status, 400);
});

test("adresse email invalide rejetée pour Magic Link", async () => {
  const r = await fetch(base + "/api/auth/magic/request", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "invalid" }),
  });
  assert.equal(r.status, 400);
});
