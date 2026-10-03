# Flowglass: rc.2 read-only execution window

This isolated adaptation is based on upstream v0.7.4 commit `98ebd6fcf4ebc41d59bcac3ab33cdc80eb3f1377`. It replaces the newer controller-dependent entrypoints with a small client adapter for Core `0.1.1-rc.2`. It does not load the upstream toolbox or send task-control requests. Upstream sources remain available for review; only this directory's `dist` is packaged.

The plugin adds “执行过程” inside the existing Sidebar Tasks page. It requires Sidebar's `taskViews` capability. Original Tasks remains the default; uninstalling the plugin restores it. No rail entry is added. The Host half registers no RPC, tool, timer, or persistence service.

Data comes from `SessionFace.getSnapshot/subscribe`, `sessions.list`, and `connection.hostDescription`. The existing runtime resolves legacy assistant chunks and final messages. This adapter copies a bounded tail, shows tool results by callId and direct-parent catalog addresses, and preserves actual Job states. Inactive is not success; disconnect/reconnect displays unknown until a new baseline. Parameters and bodies are collapsed and truncated; rendering uses React text nodes, never HTML from logs.

## Scope

This first candidate displays only the currently loaded conversation window, at most 240 timeline rows and 100 direct-child/Job rows. Missing binding, partial history and unavailable catalogs are explicit. It does not independently load cold history, refresh catalogs, or claim all historical tasks. Open the session or native Tasks view to use the existing loaders. Opening an already catalogued child uses its exact native address.

There is no fork, create, configure, prompt, continue, cancel, retry-send, export-body, or new task registry. Viewing does not change an Agent's execution. Hidden/unmounted views dispose their subscriptions. Persistent third-party Task Center data is outside this candidate because no verified public interface has been identified.

During an observed reconnect, an arbitrary new list object does not prove a new baseline: rc.2 keeps its public list phase at ready while reloading. Current timeline state therefore waits for the native Session's loading-to-open cycle; child catalogs and Jobs retain unknown until their own new publications. A settled Job whose mirror is never republished can remain unknown after reconnect. This conservative limitation avoids inventing fresh Host facts and does not change the underlying Tasks page.

## Build and verify

Run `node rc2-readonly/build.mjs` from this checkout. Set `P5_CORE_ROOT` to the isolated rc.2 Core source and run `node rc2-readonly/test.mjs`; it uses that checkout's installed tsx and source path map for the native Runtime test. The dependency-free model/module tests can run alone with `node --test rc2-readonly/test/model.test.mjs`.

`dist/BUILDINFO.json` records the fixed upstream source and client hash. Package only `rc2-readonly/dist`, with lifecycle scripts disabled during the pack step. Tests and assembled-browser evidence are distinct; keyless fixtures are not proof of a real provider run.
