---
name: developpement
description: Mène un projet logiciel jusqu'au bout, en autonomie. Installe les skills du projet pour toutes les sessions, met le dépôt GitHub à jour automatiquement (sans jamais demander de token), cherche les skills et plugins utiles, termine le développement tâche par tâche avec tests, puis débogue tout. À utiliser quand l'utilisateur tape /developpement, ou demande de « continuer », « finir » ou « terminer » le développement d'une application.
argument-hint: "[projet ou objectif, facultatif]"
---

# /developpement : finir une application, de bout en bout

Suivre les étapes dans l'ordre. Travailler en autonomie : ne poser une question que si une décision appartient vraiment à l'utilisateur. Se relire à chaque étape : l'utilisateur veut un travail minutieux et sans erreur.

## Règles permanentes

- **Jamais de token ni d'identifiant.** Ne jamais en demander, en saisir ni en enregistrer pour pousser du code. Si GitHub en exige, s'arrêter et le dire en une ligne.
- **Jamais de `git push --force`** ni de réécriture d'un historique déjà publié sans accord explicite.
- **Jamais de secret dans le dépôt** (`.env`, clés, certificats) : ils doivent être dans le `.gitignore`.
- **Ne rien présenter comme vérifié sans l'avoir vérifié.** Distinguer toujours « testé ici » de « non testé (il faut un vrai Windows, un certificat, des utilisateurs…) ».
- Auteur des commits : `Claude <noreply@anthropic.com>`.

## Étape 0 : mise en place (une fois par projet)

1. **Skills disponibles partout.** Les skills du projet vivent dans `.claude/skills/` du dépôt (actifs dans toute session ouverte sur ce dépôt). Pour toutes les autres sessions :
   - copier chaque skill dans `~/.claude/skills/` (cette session seulement : la machine est temporaire) ;
   - produire un zip par skill (`zip -r <nom>-skill.zip <nom>`), l'envoyer à l'utilisateur et lui dire de l'importer dans les réglages Skills de claude.ai, qui le synchronise dans toutes ses sessions. C'est la seule façon durable : le dire clairement.
2. **Mise à jour automatique du dépôt.** Si `.claude/hooks/auto-sync.sh` n'existe pas dans le dépôt, y copier `scripts/auto-sync.sh` de ce skill. Le déclarer dans `.claude/settings.json` comme hook `Stop` :
   `{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"bash \"$CLAUDE_PROJECT_DIR/.claude/hooks/auto-sync.sh\"","timeout":120}]}]}}`
   (fusionner avec un fichier existant, ne jamais l'écraser). Le script fait le commit si les tests passent, puis le push, et ne demande jamais d'identifiants.
3. **Vérifier qu'il se déclenchera.** Les réglages ne sont lus qu'à la racine du dossier ouvert par la session. Si la session est ouverte sur un dossier parent du dépôt, le hook ne se déclenchera pas : faire alors le commit et le push soi-même à la fin de chaque tâche (mêmes règles que le script).
4. **CLAUDE.md** du dépôt : y écrire ces règles (mise à jour automatique, pas de token, commandes de test et de lancement).

## Étape 1 : état des lieux

- Lire `CLAUDE.md`, le plan du projet (son `INDEX.md` seulement, puis la catégorie utile), `git log --oneline -15` et `git status`.
- Lancer les tests (`npm test` ou l'équivalent) et noter le résultat de départ.

## Étape 2 : chercher les outils utiles

- `ListSkills` et `SearchSkills`, puis `SearchPlugins` avec des mots-clés tirés du type de projet (par exemple : electron, desktop, windows installer, code signing, release, testing).
- Utiliser un skill déjà activé s'il couvre une tâche. Proposer un plugin non installé seulement s'il apporte un vrai gain, sans l'installer d'office.
- Si un skill demandé par l'utilisateur est introuvable : le dire, puis continuer avec ce qui existe.

## Étape 3 : liste des tâches restantes

À partir du plan, lister les tâches et les classer avec `TaskCreate` :
- **faisables ici** : code, tests automatiques, documentation, configuration de build ;
- **bloquées** : matériel absent (vrai Windows/Mac), certificat, compte payant, token, utilisateurs réels. Pour chacune, noter ce qu'il faut et préparer tout ce qui peut l'être (scripts, check-lists, configuration).

## Étape 4 : développer, tâche par tâche

Pour chaque tâche faisable, dans l'ordre du plan :
1. Lire le code concerné avant de le modifier.
2. Écrire le changement, au plus simple.
3. Ajouter ou mettre à jour les tests qui le couvrent.
4. Lancer tous les tests, puis l'application elle-même (sous Linux : `xvfb-run` avec Playwright, captures d'écran à regarder).
5. Relire le diff ligne par ligne.
6. Commit (un par tâche, message clair en français), puis push, automatiquement ou à la main selon l'étape 0.3.
7. Marquer la tâche terminée.

## Étape 5 : déboguer tout

Une fois toutes les tâches faites :
- tous les tests unitaires, plus un test de bout en bout de chaque écran (avec données simulées pour les fonctions propres à un système) ;
- vérification de la syntaxe de chaque fichier (`node --check`, etc.) ;
- `npm audit --omit=dev` (dépendances livrées) ;
- revue de code complète (skill `/code-review` s'il est disponible), avec en priorité : sécurité, gestion d'erreurs, cas limites, cohérence entre les couches ;
- lancement réel de l'application, une capture par écran, sans erreur dans la console ;
- corriger chaque problème trouvé, re-tester, puis commit et push.

## Étape 6 : rendre compte

Réponse courte, en français simple :
- ce qui est fait et vérifié (avec la preuve : tests, captures) ;
- ce qui est fait mais non vérifiable ici, et comment le vérifier ;
- ce qui est bloqué, et ce qu'il faut de la part de l'utilisateur ;
- le lien du dépôt et l'état de la synchronisation.
