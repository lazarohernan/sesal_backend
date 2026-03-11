import awsLambdaFastify from "@fastify/aws-lambda";
import { buildApp } from "./aplicacion";
import { inicializarPool } from "./base_datos/pool";
import { configuracionBDServicio } from "./servicios/configuracion-bd.servicio";

let proxy: ReturnType<typeof awsLambdaFastify>;

const init = async () => {
  await configuracionBDServicio.cargarConfiguracionPersistida();
  await inicializarPool();
  const app = await buildApp();
  proxy = awsLambdaFastify(app, { callbackWaitsForEmptyEventLoop: false });
  await app.ready();
};

const initPromise = init();

export const handler = async (event: any, context: any) => {
  context.callbackWaitsForEmptyEventLoop = false;
  await initPromise;
  const result = await new Promise((resolve, reject) => {
    proxy(event, context, (err: any, res: any) => {
      if (err) reject(err);
      else resolve(res);
    });
  });
  return result;
};
