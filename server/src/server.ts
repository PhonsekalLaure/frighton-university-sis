import { createApp } from './app.js';
import { config } from './config/env.js';

const app = createApp();

app.listen(config.port, () => {
  console.log(`🚀 Frighton University SIS Backend running on port ${config.port}`);
  console.log(`📡 Healthcheck available at: http://localhost:${config.port}/api/health`);
  console.log(`📚 LMS Integration API available at: http://localhost:${config.port}/api/v1/integration`);
});
