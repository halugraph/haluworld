# assets/ — the files attached to your nodes

Everything you attach to a node in halugraph lives here: sketches, screenshots, photos, recorded sounds,
samples, videos, CSV or JSON data. You attach them in the **Inspector → Attachments** (browse, drag and
drop, paste a screenshot with Ctrl+V, record audio, take a photo, or draw with **Sketch…**) or by
dropping files on the canvas. The graph file only stores the path of the file; the bytes are here.

## How the files are named

Each file is named `<hash>-<name>`, for example `3f9a2c1be07d44aa-layout-sketch.png`: the first 16
characters are a fingerprint of the file's content (sha256), the rest is its original name, cleaned up.
So:

* the same file attached twice is stored once;
* a changed picture or sound is a **new** file with a new name — the old one stays until you clean up;
* renaming, copying or moving nodes and graphs never moves a file.

## Two rules

* **never rename, edit or move** files here — the graphs point at these exact names. A renamed file shows
  as a missing attachment; an edited one no longer matches its fingerprint. To change a sketch, use
  **Edit sketch** in the Inspector; to change any other file, attach the new version (or use
  **Replace file…**).
* **never add files by hand** — they are not attached to anything. Attach them through halugraph instead.

## Cleaning up

Files that no node uses any more are listed as info in the Problems panel.
**File → Clean up unused attachments…** shows them and removes them in one commit.

## Git and big files

Saving commits the attached files together with the graph, so they are part of your project's history.
Every version of a big file stays in the history for good, so the repository grows: keep recordings and
videos short, and for many big files set up [Git LFS](https://git-lfs.com/) (`git lfs track
"assets/*.wav"`). A single file can be up to 50 MB by default.

The compiler agent reads these files but never changes them. Files with a `reference` role only guide
it; `embed` files are copied into the app it builds.

This README is not an attachment: halugraph ignores every file here whose name is not `<hash>-<name>`.
