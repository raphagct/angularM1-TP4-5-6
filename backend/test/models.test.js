import test, { describe } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { User } from "../src/models/User.js";
import { Track } from "../src/models/Track.js";

const baseTrack = () => ({
  ownerId: new mongoose.Types.ObjectId(),
  title: "Blues",
  originalName: "b.mp3",
  storedName: "x.mp3",
  mimeType: "audio/mpeg",
  size: 42,
});

describe("User", () => {
  test("normalise l'email en minuscules", () => {
    const user = new User({ name: "Test", email: " TEST@example.com ", password: "12345678" });
    assert.equal(user.email, "test@example.com");
  });

  test("hache le mot de passe à la validation et le vérifie", async () => {
    const user = new User({ name: "Test", email: "a@b.c", password: "12345678" });
    await user.validate();
    assert.ok(user.passwordHash);
    assert.notEqual(user.passwordHash, "12345678");
    assert.equal(await user.verifyPassword("12345678"), true);
    assert.equal(await user.verifyPassword("mauvais"), false);
  });

  test("refuse un nom trop court ou un email absent", async () => {
    const user = new User({ name: "A", password: "12345678" });
    await assert.rejects(user.validate(), (error) => {
      assert.ok(error.errors.name);
      assert.ok(error.errors.email);
      return true;
    });
  });

  test("toPublic n'expose jamais le hash", async () => {
    const user = new User({ name: "Test", email: "a@b.c", password: "12345678" });
    await user.validate();
    const output = user.toPublic();
    assert.deepEqual(Object.keys(output).sort(), ["createdAt", "email", "id", "name"]);
  });
});

describe("Track", () => {
  test("référence le modèle User", () => {
    assert.equal(Track.schema.path("ownerId").options.ref, "User");
  });

  test("les noms de stockage sont masqués par défaut", () => {
    assert.equal(Track.schema.path("storedName").options.select, false);
    assert.equal(Track.schema.path("coverStoredName").options.select, false);
  });

  test("une piste minimale est valide", async () => {
    await new Track(baseTrack()).validate();
  });

  test("refuse les champs obligatoires manquants et une taille négative", async () => {
    await assert.rejects(new Track({ size: -1 }).validate(), (error) => {
      for (const field of ["ownerId", "title", "originalName", "storedName", "mimeType", "size"]) {
        assert.ok(error.errors[field], field);
      }
      return true;
    });
  });

  test("refuse un artiste trop long", async () => {
    await assert.rejects(new Track({ ...baseTrack(), artist: "x".repeat(201) }).validate(), /artist/);
  });

  test("toPublic expose les métadonnées et hasCover, jamais les noms de stockage", () => {
    const track = new Track({
      ...baseTrack(),
      artist: "Artist",
      album: "Album",
      genre: "Jazz",
      year: 2001,
      duration: 180,
      bitrate: 320000,
      sampleRate: 48000,
      coverStoredName: "cover.png",
      coverMimeType: "image/png",
    });

    const output = track.toPublic();
    assert.equal(output.id, track.id);
    assert.equal(output.artist, "Artist");
    assert.equal(output.duration, 180);
    assert.equal(output.hasCover, true);
    assert.equal("storedName" in output, false);
    assert.equal("coverStoredName" in output, false);
    assert.equal("coverMimeType" in output, false);
  });

  test("publicFrom fonctionne avec un objet lean et hasCover=false sans pochette", () => {
    const lean = { _id: new mongoose.Types.ObjectId(), ...baseTrack() };
    const output = Track.publicFrom(lean);
    assert.equal(output.id, String(lean._id));
    assert.equal(output.ownerId, String(lean.ownerId));
    assert.equal(output.hasCover, false);
    assert.equal("_id" in output, false);
  });
});
