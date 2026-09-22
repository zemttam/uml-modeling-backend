const SELF_DECLARED_DEPS_METADATA = 'self:paramtypes';

export function getRepositoryToken(entity: { name: string }): string {
  return `${entity.name}Repository`;
}

export function InjectRepository(entity: { name: string }): ParameterDecorator {
  return (
    target: object,
    _propertyKey: string | symbol | undefined,
    index: number,
  ) => {
    const deps =
      (Reflect.getMetadata(SELF_DECLARED_DEPS_METADATA, target) as unknown[]) ??
      [];
    deps[index] = { index, param: getRepositoryToken(entity) };
    Reflect.defineMetadata(SELF_DECLARED_DEPS_METADATA, deps, target);
  };
}

export const TypeOrmModule = {
  forFeature(): { module: unknown } {
    return { module: class TypeOrmFeatureStub {} };
  },
  forRoot(): { module: unknown } {
    return { module: class TypeOrmRootStub {} };
  },
  forRootAsync(): { module: unknown } {
    return { module: class TypeOrmRootAsyncStub {} };
  },
};
