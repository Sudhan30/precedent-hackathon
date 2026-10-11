# Continue Precedent on your server

This archive contains the implementation plan, generated eve scaffold, and
unfinished policy/service source. Read HANDOFF.md for the exact checkpoint.
It contains neither a complete runnable product nor a portable chat session.

## Transfer
Download `Precedent_Server_Handoff.zip` from ChatGPT to your computer. Replace
YOUR_USER and YOUR_SERVER with your SSH destination:

```sh
scp Precedent_Server_Handoff.zip YOUR_USER@YOUR_SERVER:~/
ssh YOUR_USER@YOUR_SERVER
mkdir -p ~/projects
unzip ~/Precedent_Server_Handoff.zip -d ~/projects
cd ~/projects/precedent
```

If that directory already exists, extract into a new directory to avoid replacing
existing work. Prerequisites: Node.js 24, npm, unzip, and Zellij. Install Zellij
using your server distribution's documented method: https://zellij.dev/documentation/installation

## Start Codex inside Zellij
If Codex CLI is not already installed:

```sh
npm install -g @openai/codex
```

Create or attach the persistent terminal:

```sh
zellij attach --create precedent
```

Inside it:

```sh
cd ~/projects/precedent
codex login --device-auth
npm ci
codex "Read AGENTS.md, HANDOFF.md and Precedent_Implementation_Plan.md. Continue development from this checkpoint. Implement and test the complete hackathon demo in milestones. Keep PROGRESS.md updated with completed work, test evidence, blockers and next steps. Start by validating the existing policy/service code."
```

Skip login when already authenticated. Follow the device login flow in your own
browser. Account/organization settings may determine device-auth availability.

Detach using Zellij's default Ctrl+o then d key sequence. Reconnect later:

```sh
ssh YOUR_USER@YOUR_SERVER
zellij attach precedent
```

If Codex exited, run this from the project directory inside Zellij:

```sh
codex resume --last
```

That resumes the local CLI conversation, not this original ChatGPT conversation.
Zellij keeps processes alive across SSH disconnects while the server remains
running. Codex still stops for required input or completed work. A server reboot
interrupts running processes; resume the saved CLI conversation afterward.

## References
- https://developers.openai.com/codex/cli/
- https://developers.openai.com/codex/auth/
- https://developers.openai.com/codex/cli/reference/
- https://zellij.dev/documentation/commands
