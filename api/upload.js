const { google } = require('googleapis');
const Busboy = require('busboy');

const FOLDER_ID = '15_hvPJKeccpOVXPfFRJy8StFxdN9SVXK';
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/heic'];

module.exports = async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    try {
        // Parse Service Account credentials from environment variable
        const credentialsJson = process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS;

        if (!credentialsJson) {
            console.error('Missing GOOGLE_SERVICE_ACCOUNT_CREDENTIALS');
            return res.status(500).json({
                success: false,
                error: 'Configuration error: missing credentials'
            });
        }

        // Parse JSON (handle potential escaped newlines in private key)
        let credentials;
        try {
            credentials = JSON.parse(credentialsJson);
        } catch (parseError) {
            console.error('Failed to parse credentials JSON:', parseError);
            return res.status(500).json({
                success: false,
                error: 'Configuration error: invalid credentials format'
            });
        }

        // Authenticate with Google Drive API using Service Account
        const auth = new google.auth.GoogleAuth({
            credentials,
            scopes: ['https://www.googleapis.com/auth/drive.file'],
        });

        const drive = google.drive({ version: 'v3', auth });

        // Parse multipart form data
        const busboy = Busboy({
            headers: req.headers,
            limits: {
                fileSize: MAX_FILE_SIZE
            }
        });

        let uploadPromise = null;
        let fileName = null;
        let fileTooBig = false;

        busboy.on('file', (fieldname, file, info) => {
            const { filename, mimeType } = info;
            fileName = filename;

            // Validate file type
            if (!ALLOWED_TYPES.includes(mimeType.toLowerCase())) {
                file.resume(); // Drain the stream
                return res.status(400).json({
                    success: false,
                    error: 'Type de fichier non autorisé. Utilisez uniquement des images (JPG, PNG, GIF, WEBP, HEIC).'
                });
            }

            // Create unique filename with timestamp
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const uniqueFileName = `${timestamp}_${filename}`;

            // Track if file exceeds size limit
            file.on('limit', () => {
                fileTooBig = true;
                file.resume(); // Drain the stream
            });

            // Upload to Google Drive
            uploadPromise = drive.files.create({
                requestBody: {
                    name: uniqueFileName,
                    parents: [FOLDER_ID],
                },
                media: {
                    mimeType,
                    body: file,
                },
            });
        });

        busboy.on('finish', async () => {
            try {
                if (fileTooBig) {
                    return res.status(400).json({
                        success: false,
                        error: 'Fichier trop volumineux. Maximum 10MB.'
                    });
                }

                if (!uploadPromise) {
                    return res.status(400).json({
                        success: false,
                        error: 'Aucun fichier reçu'
                    });
                }

                // Wait for upload to complete
                const response = await uploadPromise;

                return res.status(200).json({
                    success: true,
                    fileName: fileName,
                    fileId: response.data.id
                });
            } catch (uploadError) {
                console.error('Drive upload error:', uploadError);
                return res.status(500).json({
                    success: false,
                    error: 'Erreur lors de l\'envoi vers Drive: ' + uploadError.message
                });
            }
        });

        busboy.on('error', (error) => {
            console.error('Busboy error:', error);
            return res.status(500).json({
                success: false,
                error: 'Erreur lors du traitement du fichier'
            });
        });

        // Pipe request to busboy
        req.pipe(busboy);

    } catch (error) {
        console.error('Upload handler error:', error);
        return res.status(500).json({
            success: false,
            error: 'Erreur serveur: ' + error.message
        });
    }
};
