import Model from './src/model.mjs'
import postgres from 'postgres'

function p() {
  console.log.apply(this, arguments)
}
const sql = postgres({
  host: 'localhost',
  user: 'postgres',
  password: '111111',
  database: 'test',
  max: 20,
  idle_timeout: 20,
  connect_timeout: 2,
})
const query = async (statement) => {
  // p(statement)
  return await sql.unsafe(statement)
}
await query(`
DROP TABLE IF EXISTS profile;
DROP TABLE IF EXISTS usr;

CREATE TABLE usr (
  id serial PRIMARY KEY,
  name varchar(4) UNIQUE,
  age integer);
CREATE TABLE profile (
  id serial PRIMARY KEY,
  usrName varchar(4) REFERENCES "usr" ("name") ON DELETE NO ACTION ON UPDATE CASCADE,
  info varchar(50));
`)
const Usr = Model.makeClass({
  query,
  tableName: "usr",
  fields: {
    name: { label: "姓名", unique: true, maxlength: 4, minlength: 1 },
    age: { label: "年龄", type: "integer", max: 100, min: 1, required: true },
  },
});
const Profile = Model.makeClass({
  query,
  tableName: "profile",
  fields: {
    usrName: { label: "用户", reference: Usr, referenceColumn: 'name' },
    info: { label: "信息", maxlength: 50 },
  },
});

const firstUser = { "name": "tom", "age": 22 }
await Usr.insert(firstUser).execr()
const usrs_after_insert = await Usr.all()
test('test insert one row', () => {
  expect(usrs_after_insert).toEqual([{ id: 1, ...firstUser }])
});

const bulkInsertUsers = [{ "name": "kate", "age": 21 }, { "name": "mike", "age": 11 }]
const allUsers = [firstUser, ...bulkInsertUsers]
await Usr.insert(bulkInsertUsers).execr()
const usrs_after_bulk_insert = await Usr.all()
test('test bulk insert', () => {
  for (const u of usrs_after_bulk_insert) {
    expect(u).toMatchObject(allUsers.find(e => e.name == u.name))
  }
});

const mergedUsers = [...allUsers, { "name": "foo", "age": 11 }]
await Usr.merge(mergedUsers, "name")
const usrs_after_merge = await Usr.all()
test('test merge - update && insert', () => {
  expect(usrs_after_merge.length).toBe(4)
  for (const u of usrs_after_merge) {
    expect(u).toMatchObject(mergedUsers.find(e => e.name == u.name))
  }
});

await Usr.delete({ name: "foo" }).execr()
const users_after_delete = await Usr.all()
test('test delete', () => {
  expect(users_after_delete.length).toBe(3)
  for (const u of users_after_delete) {
    expect(u).toMatchObject(allUsers.find(e => e.name == u.name))
  }
});

const mergedUpdateUsers = [{ "name": "kate", "age": 50 }, { "name": "tom", "age": 60 }]
await Usr.merge(mergedUpdateUsers, "name")
const users_after_merge_update = await Usr.all()
test('test no new rows', () => {
  expect(users_after_merge_update.length).toBe(3)
})
const kate = await Usr.select("age").where({ name: "kate" }).get()
test('test kate age changed and select age only', () => {
  expect(kate).toEqual({ age: 50 })
})
const tom = await Usr.select("age").get({ name: "tom" })
test('test tom age changed and select age only and condition in get', () => {
  expect(tom).toEqual({ age: 60 })
})

await Usr.update({ age: 66 }).where({ name: "kate" }).execr()
const usrKate = await Usr.get({ name: "kate" })
test('test update by where', () => {
  expect(usrKate.age).toEqual(66)
})

const bulkUpdateUsers = [{ "name": "tom", "age": 22 }, { "name": "kate", "age": 21 }, { "name": "foo", "age": 21 }]
await Usr.updates(bulkUpdateUsers, "name")
const users_after_updates = await Usr.all()
test('test no new rows after sql.updates', () => {
  expect(users_after_updates.length).toBe(3)
})
const kate2 = await Usr.select("age").where({ name: "kate" }).get()
test('test kate age changed back by updates', () => {
  expect(kate2).toEqual({ age: 21 })
})
const tom2 = await Usr.select("age").where({ name: "tom" }).get()
test('test tom age changed back by updates', () => {
  expect(tom2).toEqual({ age: 22 })
})
const no_foo = await Usr.select("age").where({ name: "foo" }).execr()
test('test foo is not inserted in sql.updates', () => {
  expect(no_foo.length).toBe(0)
})
const ageLt20Users = await Usr.select("name", "age").where({ age__lt: 20 }).execr()
test('test select where by age less than 20', () => {
  for (const u of ageLt20Users) {
    expect(u).toMatchObject({ "name": "mike", "age": 11 })
  }
});

await Usr.update({ age: 30 }).where({ name: "kate" }).execr()
const u30 = await Usr.get({ name: "kate" })
test('test update where and get', () => {
  expect(u30).toMatchObject({ "name": "kate", "age": 30 })
});

const profileUsers = [{ usrName: "tom", info: "dad" }, { usrName: "kate", info: "mom" }]
await Profile.merge(profileUsers, "usrName")
const p1 = await Profile.where({ usrName__age: 30 }).get()
test('test join get', () => {
  expect(p1).toMatchObject({ "name": "kate", "age": 30 })
});

const usr_from_saveCreate = await Usr.saveCreate({ name: "u1", age: 50 })
const u1 = await Usr.get({ name: "u1" })
test('test saveCreate', async () => {
  expect(u1).toMatchObject({ name: "u1", age: 50 })
});
usr_from_saveCreate.age = 33
await usr_from_saveCreate.save()
const u1_after_save = await Usr.get({ name: "u1" })
test('test save', async () => {
  expect(u1_after_save).toMatchObject({ name: "u1", age: 33 })
});

await Usr.saveUpdate({ name: "u1", age: 13 }, ["age"], "name")
const u1_after_modelsave = await Usr.get({ name: "u1" })
test('test model class save', async () => {
  expect(u1_after_modelsave).toMatchObject({ name: "u1", age: 13 })
});

it("saveCreate raise required error", async () => {
  await expect(Usr.saveCreate({ name: "u1" })).rejects
    .toThrow(new Model.ValidateError({ name: "age", message: "此项必填" }))
})
it("saveCreate raise max error", async () => {
  await expect(Usr.saveCreate({ name: "u1", age: 500 })).rejects
    .toThrow(new Model.ValidateError({ name: "age", message: `值不能大于${Usr.fields.age.max}` }))
})
it("saveCreate raise maxlength error", async () => {
  await expect(Usr.saveCreate({ name: "u11111111111", age: 3 })).rejects
    .toThrow(new Model.ValidateError({ name: "age", message: `字数不能多于${Usr.fields.name.maxlength}个` }))
})

it("insert raise max batch error", () => {
  expect(() => Usr.insert([{ name: "u2", age: 2 }, { name: "u1", age: 500 }]))
    .toThrow(expect.objectContaining({ name: "age", message: `值不能大于${Usr.fields.age.max}`,label:"年龄",index:1 }))
})
await sql.end()