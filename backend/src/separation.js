import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/*
 * Séparation de sources avec Demucs (IA open source de Meta) : le modèle
 * htdemucs reçoit un mix et prédit séparément la voix et le reste.
 * Demucs est un programme Python lancé dans un processus enfant ; le backend
 * ne fait que lui passer un fichier temporaire et relire le résultat.
 * Documentation : https://github.com/adefossez/demucs
 *
 * Le séparateur expose une seule fonction, ce qui permet aux tests de le
 * remplacer par une version simulée (createApp({ separator })).
 */

// Extensions données au fichier temporaire : Demucs reconnaît le format grâce à elles.
const EXTENSIONS = {
  "audio/mpeg": ".mp3",
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
  "audio/ogg": ".ogg",
  "audio/mp4": ".m4a",
  "audio/x-m4a": ".m4a",
};

// Un morceau de 4 minutes prend 1 à 5 minutes sur CPU ; au-delà, le processus est arrêté.
const TIMEOUT = 20 * 60 * 1000;

/** Construit les arguments de la commande Demucs (exportée pour les tests). */
export function demucsArgs(input, outDir) {
  return [
    "-m", "demucs",
    "-n", "htdemucs",
    // Seule la voix est utile pour un remix : la prod n'est pas écrite (--other-method none).
    "--two-stems", "vocals",
    "--other-method", "none",
    // MP3 192 kbps : environ 5 Mo pour 4 minutes, contre 40 Mo en WAV.
    "--mp3", "--mp3-bitrate", "192",
    "-o", outDir,
    "--filename", "{stem}.{ext}",
    input,
  ];
}

/** Lance une commande et rejette avec la fin de sa sortie d'erreur si elle échoue. */
function run(command, args, timeout) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stderr = "";
    // Demucs écrit sa progression sur stderr : seule la fin est gardée pour les logs.
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-2000);
    });
    const timer = setTimeout(() => child.kill(), timeout);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new Error(`Impossible de lancer ${command} : ${error.message}`));
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) return resolve();
      reject(new Error(`Demucs a échoué (code ${code ?? signal}) : ${stderr.trim()}`));
    });
  });
}

/**
 * `python` vient de DEMUCS_PYTHON (ex. "py" sous Windows). `args` permet aux
 * tests de lancer un faux Demucs à la place du vrai.
 */
export function createDemucsSeparator({
  python = process.env.DEMUCS_PYTHON || "python",
  args = demucsArgs,
  timeout = TIMEOUT,
} = {}) {
  // Une séparation utilise plusieurs Go de RAM : elles sont exécutées une par une.
  let queue = Promise.resolve();

  async function separate(buffer, mimeType) {
    const dir = await mkdtemp(path.join(tmpdir(), "gpc-demucs-"));
    try {
      const input = path.join(dir, "input" + (EXTENSIONS[mimeType] || ".mp3"));
      await writeFile(input, buffer);
      console.log(`[separation] Demucs démarré (${buffer.length} octets)`);
      const startedAt = Date.now();
      await run(python, args(input, dir), timeout);
      const vocals = await readFile(path.join(dir, "htdemucs", "vocals.mp3"));
      console.log(`[separation] Voix extraite en ${Math.round((Date.now() - startedAt) / 1000)} s`);
      return vocals;
    } finally {
      // Le dossier temporaire est supprimé même si Demucs a échoué.
      await rm(dir, { recursive: true, force: true }).catch((error) =>
        console.error(`[separation] Dossier temporaire non supprimé : ${dir}`, error),
      );
    }
  }

  return {
    /** Retourne la voix isolée du fichier audio, au format MP3. */
    vocals(buffer, mimeType) {
      const job = queue.then(() => separate(buffer, mimeType));
      // L'échec d'une séparation ne doit pas bloquer les suivantes.
      queue = job.catch(() => undefined);
      return job;
    },
  };
}
