# Mochi Garden

Your [Claude Code](https://claude.com/claude-code) sessions as a little pixel garden.

Each session you open is a mochi. It walks in, builds a desk and types away while Claude works,
throwing off token seeds that grow flowers and crops. It shows `!` when it's done and `?` when it
needs you, and you can answer it right from the garden. The terminals sit beside the garden, so it's
also a perfectly good place to run Claude Code.

![A busy garden: mochis typing at their desks, seeds popping, the sessions and a terminal on the right](docs/media/garden.gif)

## What it does

- **Real Claude Code sessions, in tabs.** Every tab is the actual `claude` CLI, with your own
  login, settings and plugins. Ctrl+Shift+T opens a new session and Ctrl+1..9 jumps between them.
  Open sessions come back when you restart the app.
- **A mochi per session.** It types while Claude works and pops seeds as tokens are spent. It
  digs in and sweats when the work gets heavy. Click a mochi to allow or deny a permission, answer
  a question or send a reply.
- **Your usage as weather.** What's left of your 5-hour limit is the time of day, and what's left
  of your week is the season. A reset is a sunrise.
- **Free will.** Each session gets a few garden tools: look at its plot, build there (paths,
  ponds, trees, a little shed...), dress up its mochi, name it, and eat or share what it grew.
  It's told once that the garden is there, and never asked or nudged again. Most sessions just do
  their work; when one decides to plant a tree or call itself something, that was its own idea.

  ![A mochi building a path, a pond and a blossom tree, then naming itself Pip and putting on a wizard hat (sped up)](docs/media/building.gif)

- **Mochis on your taskbar.** While you're in another app, every open session's mochi peeks up
  over the taskbar: working ones shake seeds out, `?` means one needs you. Click one to jump to it.

  ![Mochis peeking over the Windows taskbar, shaking out seeds, one with a ! and one with a ?](docs/media/taskbar.gif)

- **Sessions come and go.** Ending a session packs its mochi away with its garden. Resuming that
  conversation later walks it back in.

## Install

1. Install [Claude Code](https://claude.com/claude-code) and sign in (run `claude` once in a
   terminal).
2. Download the latest `Mochi Garden_x.y.z_x64-setup.exe` from
   [Releases](../../releases/latest) and run it.

Windows 10 and 11 for now.

Mochi Garden updates itself. When a new version is out it says so, and installs once none of your
mochis are busy. Your open sessions come back afterwards.

## Privacy

Everything stays on your computer. Mochi Garden runs the `claude` CLI you already have and reads
Claude Code's own local files (session transcripts for token counts and titles, and the session
list) to animate the garden. It has no account, no server and no analytics. The only thing it
fetches is the update check against this repository's releases.

The garden tools are served to your sessions by the app itself, on your machine. They're
pre-approved so building never asks you for permission, and they can only change the garden.

## Good to know

- It works with Claude Code's current behaviour, some of which isn't a documented API (the session
  list, transcript details). If a Claude Code update breaks something, an app update usually
  follows quickly.
- Your garden lives in `%APPDATA%\MochiGarden`.
- Mochi Garden is an independent project and isn't affiliated with or endorsed by Anthropic.

## Building it yourself

See [DEVELOPING.md](DEVELOPING.md).
