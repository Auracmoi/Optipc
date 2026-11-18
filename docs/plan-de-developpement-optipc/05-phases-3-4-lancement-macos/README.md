# Phases 3 et 4 — Lancement public puis macOS

[← Index](../INDEX.md)

**Phase 3 — Lancement public (janvier, si le point de décision est franchi)**

- [ ] Approfondir le parcours gagnant (nettoyage ou démarrage) avec ce que les testeurs ont raté
- [ ] Signer l'exécutable (certificat de signature de code, coût à vérifier) et retester l'installateur sur un PC propre
- [ ] Ajouter la mise à jour automatique
- [ ] Page de téléchargement avec la phrase retenue en phase 2
- [ ] Suivre chaque semaine : corrections terminées et réutilisation

**Phase 4 — macOS (février → mars, si la phase 3 trouve des utilisateurs réguliers)**

La surveillance fonctionne déjà sur macOS. Reste à porter le seul parcours qui a marché sur Windows : caches de `~/Library/Caches` pour le nettoyage, ou `LaunchAgents` et éléments de connexion pour le démarrage. Les autres écrans suivent seulement s'ils servent sur Windows.
