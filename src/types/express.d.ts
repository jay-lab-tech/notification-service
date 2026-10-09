declare global {
  namespace Express {
    interface Request {
      apiKey?: {
        id: string;
        serviceName: string;
      };
    }
  }
}

export {};
