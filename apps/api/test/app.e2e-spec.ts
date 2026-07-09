import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('API ODB (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/salud (GET) responde ok', async () => {
    const res = await request(app.getHttpServer()).get('/salud').expect(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.servicio).toBe('odb-api');
  });

  it('/ (GET) responde ok (health check del hosting)', () => {
    return request(app.getHttpServer()).get('/').expect(200);
  });

  it('endpoints protegidos rechazan requests sin token', async () => {
    await request(app.getHttpServer()).get('/usuarios').expect((r) => {
      expect([401, 403]).toContain(r.status);
    });
  });

  afterAll(async () => {
    await app.close();
  });
});
