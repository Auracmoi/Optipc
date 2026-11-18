# Phase 1 — Fiabilité sur vrai Windows (18 nov → 4 déc)

[← Index](../INDEX.md)

Objectif : chaque action qui modifie le PC est vérifiée sur Windows 10 et 11, ou retirée de la version de test. Fin visée : 4 déc. 2026.

**Préparer**

- [ ] Installer deux machines de test sans données importantes (machines virtuelles Windows 10 et Windows 11), avec un instantané pour revenir en arrière
- [ ] Construire l'installateur sur Windows (`npm run dist:win`) et l'installer sur une machine propre
- [ ] Noter, avec captures, chaque alerte : SmartScreen, demande de droits administrateur

**Ajouter avant les tests**

- [ ] Mode « lecture seule » : diagnostic et aperçus visibles, aucune modification possible
- [ ] Retirer le cache Windows Update de la version de test (suppression définitive, non vérifiée)

**Vérifier, écran par écran**

- [ ] Démarrage de l'app : fenêtre affichée en moins de 3 s, pas de fenêtre grise
- [ ] Nettoyage : l'espace annoncé dans l'aperçu correspond à l'espace réellement libéré, catégorie par catégorie
- [ ] Nettoyage : fichiers en cours d'utilisation ignorés sans erreur, fichiers de moins de 24 h conservés
- [ ] Démarrage : un programme désactivé reste désactivé après redémarrage, et se réactive correctement
- [ ] Réglages : chaque réglage tient après redémarrage, et « annuler » rend exactement la valeur d'origine
- [ ] Point de restauration : créé en mode administrateur, message clair quand c'est impossible
- [ ] Sécurité : analyse rapide, mise à jour des définitions, analyse avancée sans erreur
- [ ] Surveillance : fermeture d'un programme, refus propre pour un processus système
- [ ] Lancement sans droits administrateur : chaque fonction limitée l'indique clairement

**Règle :** toute action dont l'annulation échoue est retirée de la version de test, et non corrigée en urgence.
