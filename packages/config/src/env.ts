export interface ReleaseMeshEnvironment {
  databaseUrl: string;
  redisUrl: string;
  openAiApiKey?: string;
  openAiModel: string;
}

type EnvironmentSource = Readonly<Record<string, string | undefined>>;

export function loadEnvironment(source: EnvironmentSource = process.env): ReleaseMeshEnvironment {
  return {
    databaseUrl: requiredValue(source, "DATABASE_URL"),
    redisUrl: requiredValue(source, "REDIS_URL"),
    openAiApiKey: optionalValue(source, "OPENAI_API_KEY"),
    openAiModel: optionalValue(source, "OPENAI_MODEL") ?? "gpt-5.6"
  };
}

function requiredValue(source: EnvironmentSource, name: string): string {
  const value = optionalValue(source, name);

  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

function optionalValue(source: EnvironmentSource, name: string): string | undefined {
  const value = source[name]?.trim();

  return value || undefined;
}
