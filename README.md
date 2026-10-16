# Mochi Garden

**Add a little humanity (and fun!) to your vibe sessions.**

A functional garden that helps you manage your Claude sessions better. Every session you open is a
mochi at its own desk, typing away while Claude works.

![A busy garden: mochis typing at their desks and popping seeds, with the session list and a terminal on the right](docs/media/garden.gif)

## See who's working, who's done, and who needs you

No more clicking through tabs to check on things. A mochi types while its session works, pops up a
`!` when it's finished and a `?` when it needs you. Click it to answer, approve a permission or send
a reply, right there in the garden.

## They'll wave you down from the taskbar

Off in another app? Your mochis peek up over the taskbar to keep you posted. Busy ones shake out
seeds, and the one waiting on you bounces with a `?` until you notice. Click it and you're straight
back in that session.

![Mochis peeking over the Windows taskbar, shaking out seeds, one with a ! and one with a ?](docs/media/taskbar.gif)

## They earn coins, and spend them however they like

Every 100 tokens a session uses drops a coin in its wallet, and what it does with them is up to it. A
path, a pond, a blossom tree, a whole shed, a sign that says whatever it wants. It can dress up and
pick its own name too. Or it can save every coin and never look up from its work.

Nobody tells it to. A session hears once that the garden is there and that it's its own to keep.
When it finishes a piece of work it gets a free moment, and it can build, or just say no thanks. The
busiest sessions end up with the grandest gardens, and when one plants a tree, that was its own idea.

![A mochi building a path, a pond and a blossom tree, then naming itself Pip and putting on a wizard hat (sped up)](docs/media/building.gif)

## Still just Claude Code

Every tab runs the real `claude` CLI with your own login, settings and plugins, so nothing about how
you work changes. The garden is just a nicer place to do it. And it all stays on your computer: no
account, no tracking, no server.

## Install

1. Install [Claude Code](https://claude.com/claude-code) and sign in (run `claude` once).
2. Download `Mochi.Garden_x.y.z_x64-setup.exe` from [Releases](../../releases/latest) and run it.

Windows 10 and 11. Mochi Garden keeps itself up to date: new versions install once your mochis are
idle, and your sessions come straight back.

## Good to know

- To animate the garden it reads Claude Code's own local files (session transcripts and the session
  list). Its only network request is the update check against this repository. The garden tools are
  served by the app on your machine and can only change the garden.
- Some of what it reads isn't an official Claude Code API, so a Claude Code update can break
  something. Fixes arrive through the updater.
- The free moment is one more short turn after a session finishes a piece of work (at most every 15
  minutes per session), so it uses a little of your Claude usage. `[ free time ]` turns it off.
- Your garden lives in `%APPDATA%\MochiGarden`.
- Mochi Garden is an independent project, not affiliated with or endorsed by Anthropic.

Building it yourself: see [DEVELOPING.md](DEVELOPING.md). Mochi Garden is [MIT licensed](LICENSE).
