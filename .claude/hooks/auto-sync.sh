#!/usr/bin/env bash
# Mise à jour automatique du dépôt GitHub à la fin de chaque réponse de Claude.
#
# 1. S'il y a des modifications et que les tests passent : commit automatique.
# 2. S'il y a des commits non envoyés sur main : push.
# Jamais de demande d'identifiants : si GitHub en exige (token), le push échoue
# proprement et un message l'indique. Rien n'est jamais forcé (pas de --force).

set -u
cd "$(dirname "$0")/../.." || exit 0

say() { printf '{"systemMessage": "%s"}\n' "$1"; }

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0
[ "$(git rev-parse --abbrev-ref HEAD 2>/dev/null)" = "main" ] || exit 0
git remote get-url origin >/dev/null 2>&1 || exit 0
# Une opération git en cours (fusion, rebase) : on ne touche à rien.
gitdir=$(git rev-parse --git-dir)
[ -e "$gitdir/MERGE_HEAD" ] || [ -d "$gitdir/rebase-merge" ] || [ -d "$gitdir/rebase-apply" ] && exit 0

# Ne jamais demander d'identifiants : échouer plutôt que d'attendre une saisie.
export GIT_TERMINAL_PROMPT=0 GIT_ASKPASS=/bin/false SSH_ASKPASS=/bin/false GCM_INTERACTIVE=never
id_args=(-c user.name=Claude -c user.email=noreply@anthropic.com)

# --- 1. Commit automatique (seulement si les tests passent) ---
if [ -n "$(git status --porcelain)" ]; then
  # Garde-fou : ne jamais envoyer de fichier ressemblant à un secret.
  if git status --porcelain --untracked-files=all | grep -qiE '(\.env($|\.)|\.pem$|\.key$|\.pfx$|\.p12$|id_rsa|credentials|secret)'; then
    say "Mise à jour automatique suspendue : un fichier ressemblant à un secret a été modifié. Rien n'a été envoyé."
    exit 0
  fi
  if [ -f package.json ] && [ -d node_modules ]; then
    if ! npm test --silent >/dev/null 2>&1; then
      say "Mise à jour automatique suspendue : les tests échouent. Les modifications restent en local."
      exit 0
    fi
  fi
  git add -A
  files=$(git diff --cached --name-only | head -5 | tr '\n' ' ')
  git "${id_args[@]}" commit -q -m "Mise à jour automatique : ${files}" \
    -m "Co-Authored-By: Claude <noreply@anthropic.com>" || exit 0
fi

# --- 2. Push des commits non envoyés ---
git fetch -q origin main 2>/dev/null || true
ahead=$(git rev-list --count origin/main..main 2>/dev/null || echo 0)
[ "$ahead" -gt 0 ] || exit 0

if out=$(timeout 60 git -c push.negotiate=true push -q origin main 2>&1); then
  say "Dépôt GitHub mis à jour automatiquement (${ahead} commit(s))."
elif echo "$out" | grep -qiE 'auth|credential|token|403|401|permission denied|could not read username'; then
  say "Mise à jour automatique impossible : accès refusé (token requis ou dépôt inaccessible). Les commits restent en local."
else
  say "Mise à jour automatique impossible (dépôt distant en avance ou réseau). Les commits restent en local."
fi
exit 0
