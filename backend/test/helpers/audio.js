/*
 * Génère de petits fichiers audio en mémoire pour les tests, sans dépendre
 * d'un fichier binaire versionné.
 */

// En-tête de trame MPEG-1 Layer III, 128 kb/s, 44,1 kHz, stéréo, sans padding.
const FRAME_HEADER = Buffer.from([0xff, 0xfb, 0x90, 0x64]);
// Taille d'une trame : 144 * 128000 / 44100 = 417 octets.
const FRAME_SIZE = 417;

/** Construit un MP3 silencieux d'environ `frames * 26 ms`. */
export function silentMp3(frames = 40) {
  const frame = Buffer.alloc(FRAME_SIZE);
  FRAME_HEADER.copy(frame);
  return Buffer.concat(Array.from({ length: frames }, () => frame));
}

/** Encode un entier sur 4 octets « synchsafe » (7 bits utiles par octet). */
function synchsafe(size) {
  return Buffer.from([
    (size >> 21) & 0x7f,
    (size >> 14) & 0x7f,
    (size >> 7) & 0x7f,
    size & 0x7f,
  ]);
}

/** Construit une frame ID3v2.3 : identifiant, taille, flags puis contenu. */
function frame(id, content) {
  const header = Buffer.alloc(10);
  header.write(id, 0, "latin1");
  header.writeUInt32BE(content.length, 4);
  return Buffer.concat([header, content]);
}

function textFrame(id, text) {
  return frame(id, Buffer.concat([Buffer.from([0]), Buffer.from(text, "latin1")]));
}

/**
 * Préfixe un MP3 avec un tag ID3v2.3 contenant les champs demandés.
 * `picture` = { mime, data } produit une frame APIC (pochette de face).
 */
export function withId3(audio, { title, artist, album, genre, year, picture } = {}) {
  const frames = [];
  if (title) frames.push(textFrame("TIT2", title));
  if (artist) frames.push(textFrame("TPE1", artist));
  if (album) frames.push(textFrame("TALB", album));
  if (genre) frames.push(textFrame("TCON", genre));
  if (year) frames.push(textFrame("TYER", String(year)));
  if (picture) {
    frames.push(
      frame(
        "APIC",
        Buffer.concat([
          Buffer.from([0]),
          Buffer.from(`${picture.mime}\0`, "latin1"),
          Buffer.from([3, 0]),
          picture.data,
        ]),
      ),
    );
  }

  const body = Buffer.concat(frames);
  const header = Buffer.concat([Buffer.from("ID3"), Buffer.from([3, 0, 0]), synchsafe(body.length)]);
  return Buffer.concat([header, body, audio]);
}

/** Plus petit PNG valide (1x1 pixel transparent). */
export const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
