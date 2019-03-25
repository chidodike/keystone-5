const express = require('express');
const cors = require('cors');
const path = require('path');
const falsey = require('falsey');
const { commonSessionMiddleware } = require('@keystone-alpha/session');
const createGraphQLMiddleware = require('./graphql');
const initConfig = require('./initConfig');
const { createApolloServer  }= require('./apolloServer.js');

const createPublicAPI = (
  app,
  keystone,
  accessRestriction,
  apollo,
  { apiPath, graphiqlPath, port }
) => {
  const server = createApolloServer(keystone, apollo, 'public', accessRestriction);
  app.use(createGraphQLMiddleware(server, { apiPath, graphiqlPath, port, public: true }));
};

const createAPI = (
  app,
  keystone,
  accessRestriction,
  apollo,
  { name, apiPath, graphiqlPath, port, public, allowedAudiences }
) => {
  const server = createApolloServer(keystone, apollo, name, accessRestriction);
  app.use(createGraphQLMiddleware, server, {
    apiPath,
    graphiqlPath,
    port,
    public,
    allowedAudiences,
  });
};

module.exports = class WebServer {
  constructor(keystone, config) {
    this.keystone = keystone;
    this.config = initConfig(config);
    this.express = express;
    this.app = express();

    const { adminUI, cookieSecret, sessionStore } = this.config;

    if (falsey(process.env.DISABLE_LOGGING)) {
      this.app.use(require('express-pino-logger')(this.config.pinoOptions));
    }

    if (this.config.cors) {
      this.app.use(cors(this.config.cors));
    }

    if (Object.keys(keystone.auth).length > 0) {
      this.app.use(commonSessionMiddleware(keystone, cookieSecret, sessionStore));
    }

    if (adminUI && adminUI.authStrategy) {
      // Inject the Admin specific session routes.
      // ie; this includes the signin/signout UI
      this.app.use(adminUI.createSessionMiddleware());
      // Created a session middleware which will set audiences: ['admin']
      // We might want to add more different signin middlewares which let the user authenticate against different
      // strategies/allow access to different schemas!
    }

    // GraphQL API always exists independent of any adminUI or Session settings
    const { apollo } = this.config;
    const schemaName = 'admin';
    const accessRestriction = null;
    const server = createApolloServer(keystone, apollo, schemaName, accessRestriction);

    const { apiPath, graphiqlPath, port } = this.config;
    // We currently make the admin UI public. In the future we want to be able
    // to restrict this to a limited audience, while setting up a separate
    // public API with much stricter access control.
    this.app.use(
      createGraphQLMiddleware(server, { apiPath, graphiqlPath, port }, { isPublic: true })
    );

    if (adminUI) {
      // This must be last as it's the "catch all" which falls into Webpack to
      // serve the Admin UI.
      this.app.use(adminUI.createDevMiddleware({ apiPath, graphiqlPath, port }));
    }
  }

  async start(...args) {
    const {
      app,
      config: { port },
    } = this;

    await this.keystone.connect(...args);
    return new Promise((resolve, reject) => {
      app.get('/', (req, res) => res.sendFile(path.resolve(__dirname, './default.html')));

      app.listen(port, error => {
        if (error) {
          return reject(error);
        }
        return resolve({ port });
      });
    });
  }
};
