import pino from "pino";

const isTTY = process.stdout.isTTY === true;

const logger = pino(
  isTTY
    ? {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "HH:MM:ss", ignore: "pid,hostname" },
        },
      }
    : {}
);

export default logger;
