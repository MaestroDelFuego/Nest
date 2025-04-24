const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const mime = require('mime-types');

const app = express();
const PORT = process.env.PORT || 3000;

const MOVIES_DIR = path.join(__dirname, 'movies');
const PUBLIC_DIR = path.join(__dirname, 'public');

// Serve static files (e.g., index.html, thumbnails)
app.use(express.static(PUBLIC_DIR));
app.use('/movies', express.static(MOVIES_DIR)); // Serve thumbnails directly

// Stream video/audio files with range request support
app.get('/movies/:filename', async (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(MOVIES_DIR, filename);
  console.log(`[DEBUG] Requesting file: ${filePath}`);

  try {
    // Check if file exists
    await fs.access(filePath);
    console.log(`[DEBUG] File exists: ${filePath}`);

    const stat = await fs.stat(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;
    let mimeType = mime.lookup(filePath) || 'application/octet-stream';
    
    // Force video/mp4 for .mp4 files to avoid mime-types issues
    if (path.extname(filename).toLowerCase() === '.mp4') {
      mimeType = 'video/mp4';
    }
    console.log(`[DEBUG] File size: ${fileSize}, MIME type: ${mimeType}, Range: ${range || 'none'}`);

    // Handle range requests for streaming
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      if (start >= fileSize || end >= fileSize) {
        console.log(`[DEBUG] Invalid range requested: ${start}-${end}/${fileSize}`);
        return res.status(416).send('Requested range not satisfiable');
      }

      const chunksize = end - start + 1;
      const file = fs.createReadStream(filePath, { start, end });

      res.write({
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': mimeType,
        'Cache-Control': 'public, max-age=31536000',
      });

      console.log(`[DEBUG] Streaming range: ${start}-${end}, Content-Length: ${chunksize}`);
      file.pipe(res);
    } else {
      // Serve full file
      res.write({
        'Content-Length': fileSize,
        'Content-Type': mimeType,
        'Cache-Control': 'public, max-age=31536000',
      });

      console.log(`[DEBUG] Streaming full file, Content-Length: ${fileSize}`);
      fs.createReadStream(filePath).pipe(res);
    }
  } catch (error) {
    console.error(`[ERROR] Failed to serve file: ${filePath}`, error);
    res.status(404).send('File not found');
  }
});

// Serve HTML page with embedded media player
app.get('/watch/:filename', async (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(MOVIES_DIR, filename);
  console.log(`[DEBUG] Serving watch page for: ${filePath}`);

  try {
    // Check if file exists
    await fs.access(filePath);
    console.log(`[DEBUG] File exists for watch page: ${filePath}`);

    let mimeType = mime.lookup(filePath) || 'video/mp4';
    
    // Force video/mp4 for .mp4 files
    if (path.extname(filename).toLowerCase() === '.mp4') {
      mimeType = 'video/mp4';
    }
    
    // Treat application/mp4 or .mp4 files as video
    const isVideo = mimeType.startsWith('video') || mimeType === 'application/mp4' || path.extname(filename).toLowerCase() === '.mp4';
    const mediaUrl = `/movies/${filename}`;
    console.log(`[DEBUG] Watch page MIME type: ${mimeType}, isVideo: ${isVideo}, Media URL: ${mediaUrl}`);

    const htmlContent = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${path.parse(filename).name}</title>
        <style>
            body {
                margin: 0;
                padding: 0;
                display: flex;
                justify-content: center;
                align-items: center;
                height: 100vh;
                background-color: #1C1813;
                color: white;
                font-family: Arial, sans-serif;
            }
            ${isVideo ? `
            video {
                max-width: 90%;
                max-height: 80vh;
                border: 5px solid #f1f1f1;
                border-radius: 10px;
            }` : `
            audio {
                width: 90%;
                max-width: 600px;
            }`}
            .container {
                text-align: center;
            }
            h1 {
                margin-bottom: 20px;
            }
                video:fullscreen {
    border: none;
}
video:-webkit-full-screen {
    border: none;
}
video:-moz-full-screen {
    border: none;
}
        </style>
    </head>
    <body>
        <div class="container">
            <h1>${path.parse(filename).name}</h1>
            ${isVideo ? `
            <video controls autoplay>
                <source src="${mediaUrl}" type="${mimeType}">
                Your browser does not support the video tag.
            </video>` : `
            <audio controls autoplay>
                <source src="${mediaUrl}" type="${mimeType}">
                Your browser does not support the audio tag.
            </audio>`}
        </div>
    </body>
    </html>`;

    console.log(`[DEBUG] Sending watch page HTML for: ${filename}`);
    res.send(htmlContent);
  } catch (error) {
    console.error(`[ERROR] Failed to serve watch page: ${filePath}`, error);
    res.status(404).send('File not found');
  }
});

// Return list of media files with thumbnails
app.get('/movies-list', async (req, res) => {
  console.log(`[DEBUG] Fetching movies list from: ${MOVIES_DIR}`);
  try {
    const files = await fs.readdir(MOVIES_DIR);
    const media = files.filter(f => /\.(mp4|mp3)$/i.test(f));
    console.log(`[DEBUG] Found media files: ${media.join(', ')}`);

    const movies = await Promise.all(media.map(async file => {
      const base = file.replace(/\.(mp4|mp3)$/i, '');
      const thumbnail = `${base}thumbnail.png`;
      const thumbnailPath = path.join(MOVIES_DIR, thumbnail);
      const thumbnailExists = await fs.access(thumbnailPath).then(() => true).catch(() => false);
      console.log(`[DEBUG] Processing file: ${file}, Thumbnail: ${thumbnail}, Exists: ${thumbnailExists}`);

      return {
        title: base,
        video: `/watch/${file}`,
        thumbnail: thumbnailExists ? `/movies/${thumbnail}` : null,
      };
    }));

    console.log(`[DEBUG] Sending movies list: ${movies.length} items`);
    res.json(movies);
  } catch (error) {
    console.error(`[ERROR] Failed to read movies directory: ${MOVIES_DIR}`, error);
    res.status(500).send('Error reading movies directory');
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🎬 Server running at http://localhost:${PORT}`);
});