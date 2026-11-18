# OptiPC — Optimiseur de performances pour Windows

Application de bureau (Electron) qui diagnostique, surveille, nettoie et sécurise un PC Windows 10/11.

## Fonctions

| Écran | Ce qu'il fait |
|---|---|
| **Tableau de bord** | Score de santé sur 100 et liste de problèmes classés (critique / attention / conseil), chacun avec un bouton qui mène à sa solution. |
| **Surveillance** | Processeur (global et par cœur), mémoire, réseau en temps réel, espace disque, liste des processus (tri, recherche, regroupement, fermeture). Les processus système essentiels ne peuvent pas être fermés. |
| **Nettoyage** | Fichiers temporaires utilisateur et Windows, caches Chrome/Edge/Brave/Firefox, miniatures, rapports de plantage, corbeille. Aperçu de l'espace récupérable avant toute suppression. |
| **Démarrage** | Liste des programmes lancés à l'ouverture de session (registre + dossiers Démarrage) avec éditeur. Désactivation réversible, par la même méthode que le Gestionnaire des tâches. |
| **Sécurité** | État de Microsoft Defender, de la protection en temps réel, des définitions et du pare-feu. Analyses rapide, complète, d'un dossier ou d'un fichier. Historique et suppression des menaces. **Analyse avancée** (voir plus bas). |
| **Réglages** | Mode « Performances élevées », transparence, animations, mode Jeu, enregistrement Game DVR. Point de restauration système automatique avant la première modification. Chaque réglage peut être annulé. |

### Analyse avancée des menaces

Le moteur antivirus est **Microsoft Defender**, intégré à Windows et mis à jour chaque jour par Microsoft. OptiPC y ajoute une inspection heuristique, en lecture seule, qui repère les signes d'infection classiques :

- programmes **non signés** en cours d'exécution, surtout depuis `Temp`, `Téléchargements`, `Public` ou la racine d'`AppData\Roaming` ;
- entrées de démarrage et **tâches planifiées** suspectes : commandes PowerShell obfusquées (`-EncodedCommand`, `FromBase64String`, `DownloadString`, `IEX`), exécutables placés dans un dossier temporaire, entrées orphelines ;
- **fichier hosts** détourné ;
- **exclusions** ajoutées à Defender (technique fréquente des logiciels malveillants) ;
- **proxy** imposé au système.

Pour chaque élément : empreinte SHA-256, analyse ciblée par Defender, ouverture de l'emplacement, et vérification de l'empreinte sur VirusTotal (seulement si vous cliquez).

## Principes de sécurité

- **Rien n'est supprimé sans confirmation.** Le nettoyage ne touche que des dossiers fixés dans le code. Il ignore les fichiers de moins de 24 h et ne suit jamais les liens symboliques ni les jonctions.
- **Tout est réversible** : les valeurs d'origine des réglages sont sauvegardées (`%APPDATA%\OptiPC\tweaks-backup.json`), et les programmes au démarrage sont désactivés sans être supprimés.
- **Sécurité Electron** : la [liste de contrôle officielle](https://github.com/electron/electron/blob/main/docs/tutorial/security.md) est appliquée. L'interface est servie par un protocole dédié (`optipc://app/`) qui n'expose que ses propres fichiers, chaque appel au système vérifie son expéditeur, aucune autorisation (caméra, micro, notifications) n'est accordée, et les fusibles inutiles d'Electron sont coupés (`RunAsNode`, `NODE_OPTIONS`, `--inspect`).
- **Aucune injection de commande possible** : les paramètres sont transmis à PowerShell en JSON par variable d'environnement, jamais insérés dans le texte du script.
- **Interface isolée** : `contextIsolation`, `sandbox`, pas d'accès Node.js et une politique de sécurité du contenu (CSP) stricte. L'interface ne peut appeler qu'une liste fermée de fonctions, et chaque paramètre est revérifié côté système (un processus est fermé seulement si son nom correspond encore ; un élément de démarrage est modifié seulement s'il figure dans une énumération fraîche).
- **Mode lecture seule** (interrupteur en bas du menu) : diagnostic et aperçus sans aucune modification du PC. Le refus est appliqué par le processus système, pas seulement par l'interface.
- **Aucune donnée envoyée sur Internet.**

## Architecture

Tout le travail système (mesures, PowerShell, nettoyage, Defender) s'exécute dans un **processus moteur séparé** (`utilityProcess`). Certaines commandes Windows sont bloquantes ; dans le processus de la fenêtre, elles la gèleraient (fenêtre grise « Ne répond pas »). Le moteur est relancé automatiquement s'il s'arrête, et chaque opération a un délai maximal.

En cas de problème, consultez le journal `%APPDATA%\OptiPC\logs\optipc.log`.

## Lancer en développement

Prérequis : [Node.js](https://nodejs.org) 20 ou plus récent.

```bash
npm install
```

```bash
npm start
```

Pour accéder à toutes les fonctions en développement, ouvrez le terminal **en tant qu'administrateur**.

## Créer l'installateur Windows

À lancer **sur un PC Windows** :

```bash
npm run dist:win
```

Le fichier `dist\OptiPC Setup 0.1.0.exe` est créé (il est aussi construit automatiquement par GitHub Actions). L'application demande les droits administrateur à chaque lancement (`requireAdministrator`).

> L'exécutable n'est pas signé numériquement : Windows SmartScreen affichera « Windows a protégé votre ordinateur ». Pour le distribuer au public, il faudra un certificat de signature de code.

## Vérifier sur un vrai Windows

1. **Automatiquement, à chaque envoi sur GitHub** : l'onglet *Actions* du dépôt lance sur une machine Windows les tests, le contrôle ci-dessous, puis construit l'installateur. Il se télécharge dans le résumé de l'exécution (« OptiPC-installateur-windows »).
2. **Sur votre PC, sans rien modifier** : dans un terminal administrateur, à la racine du projet :

```bash
npm run check:windows
```

Chaque lecture système (mesures, nettoyage en mode mesure, démarrage, réglages, Defender, analyse avancée, diagnostic) est exécutée et vérifiée. Rien n'est supprimé ni modifié.

3. **Les actions qui modifient le PC** se vérifient à la main, sur une machine de test, avec la liste de la [phase 1 du plan](docs/plan-de-developpement-optipc/02-phase-1-fiabilite/README.md).

## Tests

```bash
npm test
```

41 tests unitaires : sécurité du nettoyage (liens symboliques, fichiers récents, chemins interdits), règles du diagnostic, garde-fous de fermeture des processus, mode lecture seule, lecture des réponses de Windows, scripts PowerShell, cohérence entre l'interface, le relais et le moteur, politique de sécurité (protocole, liens externes, expéditeurs).

```bash
npm run test:e2e
```

9 tests de bout en bout : la vraie application Electron (lancement, réactivité, moteur séparé, lecture seule conservée au redémarrage) et chaque écran avec un faux PC Windows (`test/e2e/mock-windows-api.js`). Ils demandent Playwright et son Chromium (`npm i -D playwright` puis `npx playwright install chromium`). Sous Linux sans écran, préfixer par `xvfb-run -a`.

## Structure

```
src/
  main/                 Processus principal (accès système)
    main.js             Fenêtre et sécurité Electron
    preload.js          Pont limité entre l'interface et le système
    ipc.js              Relais : liste fermée des fonctions appelables
    backend.js          Moteur (processus séparé) : tout le travail système
    backend-client.js   Lancement, relance automatique et délais du moteur
    log.js              Journal %APPDATA%\OptiPC\logs\optipc.log
    lib/
      powershell.js     Exécution sûre de PowerShell
      monitor.js        Mesures en direct, processus
      cleaner.js        Nettoyage du disque
      startup.js        Programmes au démarrage
      tweaks.js         Réglages + point de restauration
      security.js       Defender + analyse avancée
      diagnostics.js    Détection des problèmes et score
  renderer/             Interface (HTML/CSS/JS sans framework)
test/                   Tests automatiques
build/icon.png          Icône de l'application
```

## Feuille de route

1. **Windows** : version actuelle.
2. **macOS** : la surveillance fonctionne déjà. Il restera à écrire les équivalents macOS du nettoyage (caches `~/Library/Caches`, journaux), du démarrage (`LaunchAgents`, éléments de connexion) et de la sécurité (XProtect, Gatekeeper, pare-feu applicatif).
3. **iOS** : iOS interdit à une application d'optimiser l'iPhone ou d'agir sur un autre appareil. Une app iOS ne pourrait être qu'un **compagnon** : consulter l'état de santé du PC et recevoir des alertes, ce qui suppose un petit service de synchronisation.
