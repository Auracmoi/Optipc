'use strict';

/*
 * Tests de bout en bout de l'interface, écran par écran, avec un faux système
 * Windows (mock-windows-api.js). Lancement : npm run test:e2e
 * Prérequis : Playwright et son Chromium (npx playwright install chromium).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright');

const INDEX = `file://${path.join(__dirname, '..', '..', 'src', 'renderer', 'index.html')}`;
const MOCK = path.join(__dirname, 'mock-windows-api.js');
const SHOTS = path.join(__dirname, 'screenshots');

let browser;

test.before(async () => {
  browser = await chromium.launch();
  fs.mkdirSync(SHOTS, { recursive: true });
});
test.after(async () => {
  await browser?.close();
});

/** Ouvre l'application sur une page neuve et collecte toute erreur de la page. */
async function open(t) {
  const page = await browser.newPage({ viewport: { width: 1240, height: 1300 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && errors.push(`${m.type()}: ${m.text()}`));
  page.on('dialog', (d) => {
    errors.push(`dialog inattendu (XSS ?) : ${d.message()}`);
    d.dismiss();
  });
  await page.addInitScript({ path: MOCK });
  await page.goto(INDEX);
  await page.waitForSelector('.nav-btn.active');
  t.after(async () => {
    await page.close();
    assert.deepEqual(errors, [], 'aucune erreur dans la page');
  });
  return page;
}

const go = (page, id) => page.click(`[data-page="${id}"]`);
const toasts = (page) => page.$$eval('.toast', (els) => els.map((e) => e.textContent.trim()));
const confirm = (page) => page.click('.modal [data-r="1"]');

test('tableau de bord : score et recommandations', async (t) => {
  const page = await open(t);
  await page.waitForSelector('.score-ring .value strong:has-text("46")');
  assert.equal(await page.locator('.issue').count(), 7);
  assert.equal(await page.locator('.issue.critical').count(), 1);
  assert.match(await page.textContent('#stat-disk'), /93 %/);
  await page.screenshot({ path: path.join(SHOTS, 'dashboard.png') });
  // Un bouton de recommandation mène à la bonne page.
  await page.click('.issue.critical [data-goto="cleaner"]');
  await page.waitForSelector('h1:has-text("Nettoyage du disque")');
});

test('nettoyage : total sélectionné, confirmation puis résultat', async (t) => {
  const page = await open(t);
  await go(page, 'cleaner');
  await page.waitForSelector('#total');
  assert.equal((await page.textContent('#total')).trim(), '3,3 Go', 'corbeille exclue par défaut');
  assert.equal(await page.locator('input[data-cat="windows-temp"]').isDisabled(), true, 'admin requis');
  await page.click('#clean-btn');
  assert.match(await page.textContent('.modal'), /Fichiers temporaires utilisateur/);
  await confirm(page);
  await page.waitForSelector('.result-card');
  assert.match(await page.textContent('.result-card'), /3,2 Go libérés/);
  await page.screenshot({ path: path.join(SHOTS, 'cleaner.png') });
});

test('surveillance : tri, recherche, échappement et fermeture', async (t) => {
  const page = await open(t);
  await go(page, 'monitor');
  await page.waitForSelector('#proc-body tr td.proc-name');
  await page.click('th[data-sort="mem"]');
  assert.match(await page.textContent('#proc-body tr:first-child td'), /chrome\.exe \(3\)/);
  // Un nom de processus piégé s'affiche en texte, sans être exécuté.
  assert.equal(await page.locator('#proc-body script').count(), 0);
  assert.match(await page.textContent('#proc-body'), /<script>alert\(1\)<\/script>\.exe/);
  // Processus système : pas de bouton Fermer.
  assert.equal(await page.locator('[data-kill="svchost.exe"]').count(), 0);
  await page.fill('#proc-search', 'teams');
  assert.equal(await page.locator('#proc-body tr').count(), 1);
  await page.click('[data-kill="Teams.exe"]');
  await confirm(page);
  await page.waitForSelector('.toast.success');
  await page.fill('#proc-search', 'chrome');
  await page.click('[data-kill="chrome.exe"]');
  await confirm(page);
  await page.waitForSelector('.toast.error');
  assert.match((await toasts(page)).join(' | '), /Droits insuffisants/);
  await page.screenshot({ path: path.join(SHOTS, 'monitor.png') });
});

test('démarrage : désactivation et verrou administrateur', async (t) => {
  const page = await open(t);
  await go(page, 'startup');
  await page.waitForSelector('input[data-id="HKCU_RUN|Spotify"]');
  assert.match(await page.textContent('#summary'), /3 programme\(s\) actif\(s\) sur 4/);
  assert.equal(await page.locator('input[data-id="HKLM_RUN|SecurityHealth"]').isDisabled(), true);
  await page.locator('input[data-id="HKCU_RUN|Spotify"]').click({ force: true });
  await page.waitForSelector('#summary:has-text("2 programme(s) actif(s) sur 4")');
  await page.screenshot({ path: path.join(SHOTS, 'startup.png') });
});

test('sécurité : analyse rapide et analyse avancée', async (t) => {
  const page = await open(t);
  await go(page, 'security');
  await page.waitForSelector('.status-card');
  assert.equal(await page.locator('.status-card').count(), 4);
  await page.waitForSelector('#threats .list-item');
  assert.equal(await page.locator('#remove-threats').isVisible(), false, 'aucune menace active : bouton caché');
  await page.click('[data-type="QuickScan"]');
  await page.waitForSelector('.scan-progress .spinner');
  assert.equal(await page.locator('[data-type="FullScan"]').isDisabled(), true, 'une seule analyse à la fois');
  await page.waitForSelector('.scan-progress:has-text("terminée")', { timeout: 10_000 });
  assert.equal(await page.locator('[data-type="FullScan"]').isDisabled(), false);
  await page.click('#audit-btn');
  await page.waitForSelector('.finding');
  assert.equal(await page.locator('.finding').count(), 4);
  assert.equal(await page.locator('.finding .badge.high').count(), 2);
  await page.screenshot({ path: path.join(SHOTS, 'security.png') });
});

test('réglages : point de restauration obligatoire, puis application', async (t) => {
  const page = await open(t);
  await go(page, 'tweaks');
  await page.waitForSelector('input[data-id="power-plan"]');
  assert.equal(await page.locator('input[data-id="game-mode"]').isDisabled(), true, 'déjà actif avant OptiPC');
  // Le point de restauration échoue (pas admin) : le réglage n'est pas appliqué.
  await page.locator('input[data-id="power-plan"]').click({ force: true });
  await page.waitForSelector('.toast.error');
  await page.waitForFunction(() => !document.querySelector('input[data-id="power-plan"]').checked);
  // Sans point de restauration : appliqué.
  await page.uncheck('#auto-restore');
  await page.locator('input[data-id="power-plan"]').click({ force: true });
  await page.waitForFunction(() => document.querySelector('input[data-id="power-plan"]')?.checked);
  await page.screenshot({ path: path.join(SHOTS, 'tweaks.png') });
});

test('mode lecture seule : actions grisées et refusées, puis réactivées', async (t) => {
  const page = await open(t);
  await page.locator('#read-only').click({ force: true });
  await page.waitForSelector('body.read-only');
  await page.waitForSelector('.banner:has-text("Mode lecture seule")');
  await go(page, 'cleaner');
  await page.waitForSelector('#clean-btn');
  assert.equal(await page.$eval('#clean-btn', (b) => getComputedStyle(b).pointerEvents), 'none');
  // Même un appel direct est refusé (le verrou réel est côté système).
  const r = await page.evaluate(() => window.api.cleaner.clean(['user-temp']));
  assert.equal(r.ok, false);
  assert.match(r.error, /lecture seule/);
  await page.screenshot({ path: path.join(SHOTS, 'read-only.png') });
  await page.locator('#read-only').click({ force: true });
  await page.waitForFunction(() => !document.body.classList.contains('read-only'));
  assert.equal(await page.locator('.banner:has-text("Mode lecture seule")').count(), 0);
});
