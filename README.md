# FrameCoach

A web app that helps hobbyist photographers shoot like the work they admire.

You upload your own photos and a few reference photos whose style you like. FrameCoach reads the camera data in your photos, asks a vision model to describe each image, compares your style with the references, and writes a short **shooting recipe**: concrete things to try on your next shoot, each one tied to evidence from your own photos.

This is a course project for BUS 43100 (mid-quarter prototype). It is a work in progress, not a finished product.

## Why this exists

Tools already exist that critique single photos, show camera statistics, or edit a picture to look like another. The part I could not find in the products I reviewed is advice on how to *capture* a look you admire. FrameCoach is built around that gap. I do not claim no such tool exists, and part of this project is testing whether FrameCoach is actually better than uploading photos to a general chat assistant.

## How it works

1. **Camera data is read in your browser** before any image is resized (resizing removes it).
2. **Duplicates are skipped** using a hash of each file, so the same photo is analyzed once.
3. **Images are shrunk** (about 1600 px on the long side) and checked for brightness, saturation and dominant colors by code. Only the reduced image is sent for analysis.
4. **A vision model describes each photo** (subject, composition, light, color mood) in a fixed format.
5. **Code, not the model, computes** the statistics and the gaps between your photos and the references.
6. **The model writes a recipe** of at most seven items. A validator checks each one.

### Design rules

* **Code measures, the model judges.** Camera settings and counts come from the files, never from the model.
* **Every claim is labeled** `Measured`, `Observed` or `Inferred`. Anything said about a reference photo's settings or lighting is `Inferred`, because references usually have no camera data.
* **Advice must cite your own photos.** A recipe item with no evidence is rejected.
* **At least one specific weakness** appears in every report, so it is not pure praise.
