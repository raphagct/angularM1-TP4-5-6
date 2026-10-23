import { Readable } from "node:stream";
import mongoose from "mongoose";

/*
 * Remplace GridFS dans les tests : même interface que createGridFsStorage,
 * mais les fichiers restent dans une Map. `files` permet aux tests de
 * vérifier ce qui a été écrit ou supprimé.
 */
export function createMemoryStorage() {
  const files = new Map();

  return {
    files,

    async save(buffer, { filename, contentType }) {
      const id = new mongoose.Types.ObjectId();
      files.set(String(id), { data: Buffer.from(buffer), filename, contentType });
      return id;
    },

    async info(id) {
      const file = files.get(String(id));
      return file ? { length: file.data.length } : null;
    },

    stream(id, { start = 0, end } = {}) {
      const file = files.get(String(id));
      if (!file) {
        const stream = new Readable({ read() {} });
        process.nextTick(() => stream.destroy(new Error(`FileNotFound: ${id}`)));
        return stream;
      }
      return Readable.from([file.data.subarray(start, end)]);
    },

    async remove(id) {
      if (!files.delete(String(id))) throw new Error(`FileNotFound: ${id}`);
    },
  };
}
