import express from 'express';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { config } from './config';
import { initDb } from './db';
import { monitor } from './monitor';
import { initWs } from './ws';
import { discordBot } from './discord/bot';
import authRoutes from './routes/auth';
import serverRoutes from './routes/servers';
import userRoutes from './routes/users';
import discordRoutes from './routes/discord';

initDb();

const app = express();
app.disable('x-powered-by');
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/servers', serverRoutes);
app.use('/api/users', userRoutes);
app.use('/api/discord', discordRoutes);

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// Serve the built web UI in production
const webDist = path.resolve(__dirname, '../../web/dist');
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get('*', (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
}

const httpServer = http.createServer(app);
initWs(httpServer);
monitor.start();
discordBot.start().catch((err) => console.error('[discord] startup error:', err));

httpServer.listen(config.port, () => {
  console.log(`Server Manager listening on port ${config.port}`);
  console.log(`Data directory: ${config.dataDir}`);
  console.log(`Docker: ${config.dockerHost || config.dockerSocket}`);
});

process.on('SIGTERM', async () => {
  monitor.stop();
  await discordBot.stop();
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000);
});
