# usage-band

A [Claude Code mod](https://code.claude.com/docs/en/plugins/mods/overview) that shows your plan's usage limits in a band above the prompt of the Claude desktop app, and can lock a session so that a stray Escape or prompt does not interrupt it. Each limit is one small mark and a percentage:

```text
(hourglass) (dial) 42%    (calendar) (dial) 92%    (padlock)
```

- The **hourglass** is the current session, the five-hour window. The **calendar** is the weekly one, seven days.
- The dial's **outer ring** is the share of the limit used. The **wedge in its centre** is the time left before the window resets: full when the window opens, empty at the reset.
- The ring and the percentage are blue below 70%, amber from 70%, and red from 90%.
- The **padlock** is the [session lock](#session-lock), and its button: open and grey while the session is free, shut and blue while it is locked. Press it to lock the session, and again to unlock it.
- The band draws on the desktop surface only, and only once a response has reported a limit. An account with no subscription limits (an API key) never sees it.
- A window past its reset time stays on the band at 0% with an empty wedge, until the next reply reports the new window.
- `/usage-band` hides the band for the session, or shows it again.

The marks are drawn as images, which cannot read the app's theme, so their colours are mid-tones chosen to hold on both the light and the dark ground.

## Session lock

Lock a session you want left alone while it works: press the padlock in the band, or run `/usage-band lock`. Until you unlock it:

- **Escape does not stop it.** A small pane opens beside the transcript and takes the keyboard. Escape pressed there is the pane's own close key, and the mod refuses that close, so the key goes no further: the turn and its background agents keep running. Click somewhere else and the pane takes the keyboard back.
- **The prompt box is closed.** It takes no typing while the session is locked, and a prompt that reaches the session from you another way, such as over Remote Control, is refused. A draft that was already in the box when you locked is set aside and put back when you unlock; nothing typed during the lock comes back. What does not come from you still arrives: background agents and tasks reporting back, scheduled wake-ups, other sessions, and the desktop app's own events, such as a failed check on a pull request it watches.

Unlock with **Unlock** in the pane, or with the padlock in the band. `/usage-band unlock` does the same from wherever you can still type it, such as over Remote Control. The Stop button is left alone: a click on it stops the turn, locked or not.

The limits of it:

- A mod cannot veto an interrupt. The lock works one step earlier, by keeping Escape from reaching the prompt box, so it holds only while the lock pane has the keyboard. Where the app will not hand it over (a dialog is open, or the cursor is in another text field with something typed), Escape does what it always did until the pane has the keyboard again. A locked session asks for it four times a second.
- This rests on how the desktop app handles Escape today, in October 2026. It is not something the mod API promises, and an update of the app can change it.
- While a turn runs, lock with the padlock: a typed `/usage-band lock` may wait for the turn to end.
- With the keyboard held by the pane, a permission prompt or a question is answered with the mouse.
- The lock is per session and needs the desktop app. In a terminal `/usage-band lock` says so and locks nothing.
- The padlock is a picture with a blank button laid over it, since a mod's button can show only text. A screen reader reads the picture as `Session lock: on` or `off`, then a button with no name. `/usage-band lock` and **Unlock** in the pane work without it.

## Install

The repository is its own marketplace:

```bash
claude plugin marketplace add ~/Developer/JS/claude-usage-band
```

```bash
claude plugin install usage-band@claude-usage-band
```

New sessions load it. After a change, bump `version` in `.claude-plugin/plugin.json` and run `claude plugin update usage-band@claude-usage-band`.

## Develop

```bash
claude --plugin-dir .
```

loads the folder for one session and reloads the module on save.

```bash
claude plugin validate .claude-plugin/plugin.json
```

```bash
claude plugin test .
```

A load with `--plugin-dir` also writes the API types of the build you run to `.claude-plugin/types`, which git ignores. `tsconfig.json` extends the one laid there, so after a first load:

```bash
tsc -p .
```

## Diagrams

`docs/usage-band-feed.bpmn` is a BPMN 2.0 file: what keeps the band's figures current, and what each redraw of the band changes. `docs/bpmn.html` renders it with [bpmn-js](https://bpmn.io/toolkit/bpmn-js/); any BPMN tool opens the file itself.

Both are written by `docs/make_bpmn.py`. After changing it, regenerate them:

```bash
python3 docs/make_bpmn.py docs
```

## License

MIT, generated and verified with [license-wizard](https://github.com/erdembircan/license-wizard) (`license-wizard --verify --strict`).
