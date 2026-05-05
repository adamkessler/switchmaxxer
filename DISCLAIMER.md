# Switchmaxxer Disclaimers

## Security disclaimer

Switchmaxxer is a hobby project and still in public pre-release beta.

Expect there to be issues. Open the codebase in VS Code and ask your coding agent to help.

## Switchmaxxer Default Trust Model

By default, Switchmaxxer operates as a single-operator system: it assumes one trusted user controlling the system. It is not designed to enforce isolation between multiple users sharing the same system.

This means Switchmaxxer does not, in its default configuration, prevent one user from accessing another's data or influencing the agent's behavior on another user's behalf. Hardened configuration settings are available for environments that require stricter controls, but the out-of-the-box posture is permissive and intended for personal use.

If your deployment involves multiple users, you should review the hardened configuration options before rolling Switchmaxxer out more broadly. This is especially important when users should not have visibility into one another's activity.

If you’re not comfortable with security hardening and access control then don’t run Switchmaxxer.

Ask someone experienced to help before using it to connect OpenClaw
or Hermes Agent to the Internet.
