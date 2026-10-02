# usage-band

A [Claude Code mod](https://code.claude.com/docs/en/plugins/mods/overview) that shows your plan's usage limits in a band above the prompt of the Claude desktop app:

```text
Current session ▬▬▬▬────── 42% · resets in 2h 14m    Weekly ▬▬▬▬▬▬▬▬▬─ 92% · resets in 3d 4h    ✕
```

- **Current session** is the five-hour window, **Weekly** the seven-day one.
- The figure turns to the theme's warning colour from 75% and to its error colour from 90%, where the bar turns red too.
- The band draws on the desktop surface only, and only once a response has reported a limit. An account with no subscription limits (an API key) never sees it.
- A window past its reset time stays on the band, shown as `0% · reset`, until the next reply reports the new window.
- The close control hides the band for the session. `/usage-band` shows or hides it.

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

## License

MIT, generated and verified with [license-wizard](https://github.com/erdembircan/license-wizard) (`license-wizard --verify --strict`).
