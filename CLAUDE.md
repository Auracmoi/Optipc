# OptiPC — consignes pour Claude

Application Electron d'optimisation de PC Windows. Langue du projet : français.

## Mise à jour automatique du dépôt GitHub

Le propriétaire veut que le dépôt `Auracmoi/Optipc` soit mis à jour automatiquement, sans qu'on lui demande.

- Travailler directement sur la branche `main`, sans pull request, sauf demande contraire.
- À la fin de chaque réponse, le hook `.claude/hooks/auto-sync.sh` fait le commit de toutes les modifications (si `npm test` passe), puis les envoie (push) sur `main`.
- Ne jamais demander, saisir ni enregistrer de token ou d'identifiant pour ça. Si l'envoi exige des identifiants, s'arrêter et le signaler en une ligne.
- Jamais de `git push --force`. Si le dépôt distant a avancé, récupérer (`git pull --rebase`) puis réessayer.
- Auteur des commits : `Claude <noreply@anthropic.com>`.

## Commandes

- Tests : `npm test` (doivent passer avant tout envoi)
- Lancer l'app : `npm start`
- Installateur Windows (sur Windows) : `npm run dist:win`

## Documentation

- Plan de développement : lire `docs/plan-de-developpement-optipc/INDEX.md`, puis seulement la catégorie utile.
- Ranger un document par catégories : skill `/classify`.
