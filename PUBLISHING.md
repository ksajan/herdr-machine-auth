# Publishing checklist

The mod is ready. This folder is the gallery submission for **Machine auth**.

1. The repo is <https://github.com/ksajan/herdr-machine-auth>.
2. Keep the topic **`herdr-mod`**. The gallery at <https://herdr.dev/mods>
   picks up `herdr-mod` repos within about an hour.
3. Keep these paths at the repo root:
   - `mods/machine-auth/main.js`
   - `mods/machine-auth/mod.json`
   - `mods/machine-auth/keys.json`
   - `RECIPE.md`
   - `preview.png`
4. Do not commit `jsconfig.json`, `gpui-kit.d.ts`, `.error` files or other
   generated app-home files.
5. The gallery install line is:

   ```text
   Read ~/.config/herdr-app/AGENTS.md, then add this mod:
   herdr.dev/mods/ksajan/herdr-machine-auth
   ```

## Local check before pushing

```sh
herdr-app check ./mods/machine-auth
node --check ./mods/machine-auth/main.js
python3 -m json.tool ./mods/machine-auth/mod.json >/dev/null
```

The preview uses a synthetic `build-box` machine. It does not contain a real
host, IP, password, token or terminal content.
