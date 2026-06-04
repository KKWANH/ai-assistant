import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { DirEntry, DirListing } from "@ariadne/shared";
import { rejectRemoteAccess, rejectGuest } from "./workspaceGuard.js";

/**
 * Filesystem browsing for the workspace folder picker.
 *
 * This lists directories on the host the server runs on — which is exactly
 * the point of a local-first app — but it does expose the filesystem. Phase 2
 * places these routes behind authentication.
 */
export async function fsRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/fs/list?path=  — list a directory (defaults to the home dir)
  app.get<{ Querystring: { path?: string } }>("/fs/list", async (req, reply) => {
    if (await rejectRemoteAccess("The folder picker only runs on the machine hosting Ariadne.", req, reply)) return;
    if (await rejectGuest(req, reply)) return;
    const raw = req.query.path?.trim();
    const target = raw && raw !== "" ? path.resolve(raw) : os.homedir();

    let stat: fs.Stats;
    try {
      stat = fs.statSync(target);
    } catch {
      return reply.status(404).send({ error: "Path not found", detail: target });
    }
    if (!stat.isDirectory()) {
      return reply.status(400).send({ error: "Not a directory", detail: target });
    }

    let entries: DirEntry[];
    try {
      entries = fs
        .readdirSync(target, { withFileTypes: true })
        .filter((d) => !d.name.startsWith(".")) // hide dotfiles
        .map((d) => {
          let isDirectory = d.isDirectory();
          if (d.isSymbolicLink()) {
            try {
              isDirectory = fs.statSync(path.join(target, d.name)).isDirectory();
            } catch {
              isDirectory = false;
            }
          }
          return { name: d.name, path: path.join(target, d.name), isDirectory };
        })
        .sort((a, b) => {
          if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
          return a.name.localeCompare(b.name);
        })
        .slice(0, 1000); // guard against huge directories
    } catch (err) {
      return reply
        .status(403)
        .send({ error: "Cannot read directory", detail: String(err) });
    }

    const parent = path.dirname(target);
    const listing: DirListing = {
      path: target,
      parent: parent === target ? null : parent,
      entries,
    };
    return reply.send(listing);
  });

  // POST /api/fs/mkdir  — create a new folder (for new projects)
  app.post<{ Body: { parent?: string; name?: string } }>(
    "/fs/mkdir",
    async (req, reply) => {
      if (await rejectRemoteAccess("The folder picker only runs on the machine hosting Ariadne.", req, reply)) return;
      if (await rejectGuest(req, reply)) return;
      const parent = req.body?.parent?.trim();
      const name = req.body?.name?.trim();
      if (!parent || !name || /[/\\]/.test(name)) {
        return reply
          .status(400)
          .send({ error: "Invalid parent path or folder name" });
      }
      const dest = path.join(path.resolve(parent), name);
      try {
        fs.mkdirSync(dest, { recursive: false });
      } catch (err) {
        return reply
          .status(400)
          .send({ error: "Could not create folder", detail: String(err) });
      }
      return reply.send({ path: dest });
    }
  );
}
