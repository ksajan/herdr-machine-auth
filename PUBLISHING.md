# Publishing checklist

The mod itself is ready. This folder is the gallery submission.

1. Push this folder to a public GitHub repo named `herdr-machine-login`
   (or any name; the folder layout matters).
2. Add the topic **`herdr-mod`** to the repo. The gallery at
   <https://herdr.dev/mods> picks up `herdr-mod` repos within about an hour.
3. Keep these paths at the repo root:
   - `mods/machine-login/main.js`
   - `mods/machine-login/mod.json`
   - `RECIPE.md`
   - `preview.png`
4. Do not commit `jsconfig.json`, `gpui-kit.d.ts`, `.error` files or other
   generated app-home files.
5. After the gallery entry exists, its install line will be:

   ```text
   Read ~/.config/herdr-app/AGENTS.md, then add this mod:
   herdr.dev/mods/<owner>/herdr-machine-login
   ```

6. Optional: add a short release note or tag. The gallery does not require it.

## Local check before pushing

```sh
herdr-app check ./mods/machine-login
node --check ./mods/machine-login/main.js
python3 -m json.tool ./mods/machine-login/mod.json >/dev/null
```

The preview uses a synthetic `build-box` machine. It does not contain a real
host, IP, password, token or terminal content.
