'use strict';

/*
 * Durcissement Electron, d'après la liste de contrôle officielle
 * (electron/docs/tutorial/security.md) :
 *  - n°5  : refuser toute demande d'autorisation (caméra, micro, notifications…) ;
 *  - n°13 : interdire la navigation hors de l'application ;
 *  - n°14/15 : n'ouvrir dans le navigateur qu'une liste fermée de sites ;
 *  - n°17 : vérifier l'expéditeur de chaque appel IPC ;
 *  - n°18 : servir l'interface par un protocole dédié plutôt que file://.
 * Les fonctions de décision sont pures (sans Electron) pour être testées.
 */

const fs = require('node:fs/promises');
const path = require('node:path');

const SCHEME = 'optipc';
const HOST = 'app';
const APP_ORIGIN = `${SCHEME}://${HOST}`;
const INDEX_URL = `${APP_ORIGIN}/index.html`;
const RENDERER_DIR = path.join(__dirname, '..', 'renderer');

// Seuls sites que l'application peut ouvrir dans le navigateur.
const EXTERNAL_HOSTS = new Set(['www.virustotal.com']);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

/** L'URL appartient-elle à l'application ? (comparaison d'origine, pas de préfixe de texte) */
function isAppUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === `${SCHEME}:` && u.host === HOST;
  } catch {
    return false;
  }
}

/** Le lien peut-il être ouvert dans le navigateur ? https + site de la liste fermée uniquement. */
function isSafeExternal(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && EXTERNAL_HOSTS.has(u.hostname) && !u.username && !u.password;
  } catch {
    return false;
  }
}

/** Fichier de l'interface correspondant à une URL optipc://app/…, ou null s'il sort du dossier. */
function resolveAppFile(url) {
  if (!isAppUrl(url)) return null;
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(url).pathname);
  } catch {
    return null;
  }
  if (pathname === '/' || pathname === '') pathname = '/index.html';
  const file = path.resolve(RENDERER_DIR, `.${pathname}`);
  const rel = path.relative(RENDERER_DIR, file);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  if (!MIME[path.extname(file).toLowerCase()]) return null;
  return file;
}

/** Réponse du protocole optipc:// : uniquement les fichiers du dossier de l'interface. */
async function serveAppRequest(request) {
  const file = resolveAppFile(request.url);
  if (!file) return new Response('Introuvable', { status: 404 });
  try {
    const body = await fs.readFile(file);
    return new Response(body, { headers: { 'content-type': MIME[path.extname(file).toLowerCase()] } });
  } catch {
    return new Response('Introuvable', { status: 404 });
  }
}

/** L'appel IPC vient-il bien de la page de l'application ? */
function isTrustedSender(frame) {
  return Boolean(frame && frame.url && isAppUrl(frame.url));
}

/** À appeler avant app.whenReady() : déclare le protocole comme sûr (CSP 'self', stockage). */
function registerScheme(protocol) {
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ]);
}

/** À appeler après app.whenReady(). */
function install({ app, protocol, session, shell }) {
  protocol.handle(SCHEME, serveAppRequest);

  // n°5 : aucune autorisation n'est jamais accordée (l'application n'en a besoin d'aucune).
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);

  // n°13 et n°14 : pour toute page créée (y compris d'éventuelles futures fenêtres).
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-navigate', (event, url) => {
      if (!isAppUrl(url)) event.preventDefault();
    });
    contents.on('will-attach-webview', (event) => event.preventDefault());
    contents.setWindowOpenHandler(({ url }) => {
      if (isSafeExternal(url)) setImmediate(() => shell.openExternal(url));
      return { action: 'deny' };
    });
  });
}

module.exports = {
  SCHEME, APP_ORIGIN, INDEX_URL, EXTERNAL_HOSTS,
  isAppUrl, isSafeExternal, resolveAppFile, serveAppRequest, isTrustedSender, registerScheme, install,
};
