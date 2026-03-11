export const config = {
  port: parseInt(process.env.PORT || '8000', 10),
  databaseUrl: process.env.DATABASE_URL || '',
  jwtSecret: process.env.JWT_SECRET || 'dev-secret',
  ow: {
    apiKey: process.env.OW_API_KEY || '',
    appId: process.env.OW_APP_ID || '',
    appSecret: process.env.OW_APP_SECRET || '',
    baseUrl: process.env.OW_BASE_URL || 'https://api.openwearables.com',
  },
};
