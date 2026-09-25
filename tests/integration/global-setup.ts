import { recreateSchema } from "../helpers/db";

export default async function globalSetup(): Promise<void> {
  await recreateSchema();
}
