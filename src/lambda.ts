import awsLambdaFastify from "@fastify/aws-lambda";
import { buildApp } from "./aplicacion";
import { inicializarPool } from "./base_datos/pool";
import { configuracionBDServicio } from "./servicios/configuracion-bd.servicio";

let proxy: ReturnType<typeof awsLambdaFastify>;

const init = async () => {
  await configuracionBDServicio.cargarConfiguracionPersistida();
  await inicializarPool();
  const app = await buildApp();
  await app.ready();
  proxy = awsLambdaFastify(app);
};

const initPromise = init();

export const handler = async (event: any, context: any, callback: any) => {
  await initPromise;
  return proxy(event, context, callback);
};
