#!/bin/bash

REPO="$HOME/development/git/straeto_speedometer"

for cmd in claude claude-esp tmux; do
  command -v "$cmd" &>/dev/null || { echo "ERROR: $cmd not found"; exit 1; }
done

osascript <<EOF
tell application "iTerm2"
  activate

  -- Create a new window
  create window with default profile

  tell current session of current tab of current window
    -- Pane 1: claude-esp (left)
    write text "cd $REPO && claude-esp"

    -- Pane 2: lead (right) — --teammate-mode tmux opens each agent in its own iTerm2 pane
    set newSession to (split vertically with default profile)
    tell newSession
      write text "cd $REPO && export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 && claude --teammate-mode tmux --model opus --effort max --permission-mode acceptEdits '/agent-session'"
    end tell
  end tell
end tell
EOF
