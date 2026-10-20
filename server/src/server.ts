import { createApp } from './app.js';
import { config } from './config/env.js';

const app = createApp();

app.listen(config.port, () => {
  console.log(`🎓 Frighton University Student Information System (SIS) running on port ${config.port}`);
  console.log(`📡 Healthcheck: http://localhost:${config.port}/api/health`);
  console.log(`📚 LMS Integration API: http://localhost:${config.port}/api/v1/integration`);
});
