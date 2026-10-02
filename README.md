# usage-band

A [Claude Code mod](https://code.claude.com/docs/en/plugins/mods/overview) that shows your plan's usage limits in a band above the prompt of the Claude desktop app. Each limit is one small mark and a percentage:

```text
(hourglass) (dial) 42%    (calendar) (dial) 92%
```

- The **hourglass** is the current session, the five-hour window. The **calendar** is the weekly one, seven days.
- The dial's **outer ring** is the share of the limit used. The **wedge in its centre** is the time left before the window resets: full when the window opens, empty at the reset.
- The ring and the percentage are blue below 70%, amber from 70%, and red from 90%.
- The band draws on the desktop surface only, and only once a response has reported a limit. An account with no subscription limits (an API key) never sees it.
- A window past its reset time stays on the band at 0% with an empty wedge, until the next reply reports the new window.
- `/usage-band` hides the band for the session, or shows it again.

The marks are drawn as images, which cannot read the app's theme, so their colours are mid-tones chosen to hold on both the light and the dark ground.

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

The API types `tsconfig.json` reads live in `.claude/types`, which `/plugin-types` writes for the build you run.

## Diagrams

`docs/usage-band-visibility.bpmn` and `docs/usage-band-feed.bpmn` are BPMN 2.0 files: when the band is shown, and how its figures are kept current. `docs/bpmn.html` renders both with [bpmn-js](https://bpmn.io/toolkit/bpmn-js/); any BPMN tool opens the files themselves.

All three are written by `docs/make_bpmn.py`. After changing it, regenerate them:

```bash
python3 docs/make_bpmn.py docs
```

## License

MIT, generated and verified with [license-wizard](https://github.com/erdembircan/license-wizard) (`license-wizard --verify --strict`).
