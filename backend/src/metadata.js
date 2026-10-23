import { parseBuffer } from "music-metadata";

/*
 * music-metadata lit les tags d'un fichier audio (ID3 pour le MP3, Vorbis
 * comments pour l'OGG, atoms pour le M4A...) ainsi que les informations
 * techniques du flux (durée, débit, fréquence d'échantillonnage).
 * Documentation : https://github.com/Borewit/music-metadata
 */

/** Extensions associées aux types d'image acceptés pour une pochette. */
export const IMAGE_EXTENSIONS = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

/**
 * Certains encodeurs écrivent "jpg" ou "image/jpg" au lieu d'un vrai type
 * MIME. On ramène ces variantes vers un type connu, ou null si inconnu.
 */
export function normalizeImageMime(format) {
  const value = String(format || "").toLowerCase().trim();
  const mime = value.includes("/") ? value : `image/${value}`;
  const normalized = mime === "image/jpg" ? "image/jpeg" : mime;
  return IMAGE_EXTENSIONS[normalized] ? normalized : null;
}

/** Retourne la première chaîne non vide parmi les candidats, sinon undefined. */
export function pickText(...candidates) {
  for (const candidate of candidates) {
    const value = typeof candidate === "string" ? candidate.trim() : "";
    if (value) return value;
  }
  return undefined;
}

/** Garde un nombre fini et positif, sinon undefined. */
function positiveNumber(value) {
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * Transforme le résultat brut de music-metadata en un objet simple, sans
 * dépendance à la bibliothèque. Fonction pure : facile à tester.
 */
export function normalizeMetadata(raw) {
  const common = raw?.common ?? {};
  const format = raw?.format ?? {};
  const picture = common.picture?.find((p) => p?.data?.length > 0);
  const pictureMime = picture ? normalizeImageMime(picture.format) : null;

  return {
    title: pickText(common.title),
    artist: pickText(common.artist, common.albumartist),
    album: pickText(common.album),
    genre: pickText(...(common.genre ?? [])),
    year: Number.isInteger(common.year) ? common.year : undefined,
    duration: positiveNumber(format.duration),
    bitrate: positiveNumber(format.bitrate),
    sampleRate: positiveNumber(format.sampleRate),
    picture: pictureMime ? { data: picture.data, mimeType: pictureMime } : null,
  };
}

/**
 * Lit les métadonnées d'un fichier reçu en mémoire. Un fichier sans tags ou
 * mal formé ne doit pas faire échouer l'upload : l'erreur est journalisée et
 * un objet vide est retourné. Le parser est injectable pour les tests.
 */
export async function extractMetadata(buffer, mimeType, parse = parseBuffer) {
  try {
    const raw = await parse(buffer, { mimeType }, { duration: true });
    const metadata = normalizeMetadata(raw);
    console.log(
      `[metadata] Tags lus : titre=${metadata.title ?? "-"}, artiste=${metadata.artist ?? "-"}, pochette=${Boolean(metadata.picture)}`,
    );
    return metadata;
  } catch (error) {
    console.error("[metadata] Lecture des tags impossible", error);
    return normalizeMetadata(null);
  }
}
