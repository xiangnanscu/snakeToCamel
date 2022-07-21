
import Field from '@xiangnanscu/field'
import Sql from '@xiangnanscu/sql'
import Modelsql from '@xiangnanscu/modelsql'


const getLocalTime = Field.basefield.getLocalTime
const DEFAULT_STRING_MAXLENGTH = 255;
const PG_KEYWORDS =
  "ALL,ANALYSE,ANALYZE,AND,ANY,ARRAY,AS,ASC,ASYMMETRIC,AUTHORIZATION,BINARY,BOTH,CASE,CAST,CHECK,COLLATE,COLLATION,COLUMN,CONCURRENTLY,CONSTRAINT,CREATE,CROSS,CURRENT_CATALOG,CURRENT_DATE,CURRENT_ROLE,CURRENT_SCHEMA,CURRENT_TIME,CURRENT_TIMESTAMP,CURRENT_USER,DEFAULT,DEFERRABLE,DESC,DISTINCT,DO,ELSE,END,EXCEPT,FALSE,FETCH,FOR,FOREIGN,FREEZE,FROM,FULL,GRANT,GROUP,HAVING,ILIKE,IN,INITIALLY,INNER,INTERSECT,INTO,IS,ISNULL,JOIN,LATERAL,LEADING,LEFT,LIKE,LIMIT,LOCALTIME,LOCALTIMESTAMP,NATURAL,NOT,NOTNULL,NULL,OFFSET,ON,ONLY,OR,ORDER,OUTER,OVERLAPS,PLACING,PRIMARY,REFERENCES,RETURNING,RIGHT,SELECT,SESSION_USER,SIMILAR,SOME,SYMMETRIC,TABLE,TABLESAMPLE,THEN,TO,TRAILING,TRUE,UNION,UNIQUE,USER,USING,VARIADIC,VERBOSE,WHEN,WHERE,WINDOW,WITH";
const IS_PG_KEYWORDS = Object.fromEntries(
  PG_KEYWORDS.split(",").map(function (e) {
    return [e, true];
  })
);
const unique = (value, index, self) => self.indexOf(value) === index
let nonMergeNames = {
  Sql: true,
  fields: true,
  fieldNames: true,
  extends: true,
  mixins: true,
};
function assert(bool, errMsg) {
  if (!bool) {
    throw new Error(errMsg)
  } else {
    return bool
  }
}
function modelReadyForSql(model) {
  return model.tableName && model.fieldNames && model.fields;
}
function makeFieldFromJson(json, kwargs) {
  let options = { ...json, ...kwargs };
  if (!options.type) {
    if (options.reference) {
      options.type = "foreignkey";
    } else if (options.model || options.subfields) {
      options.type = "table";
    } else {
      options.type = "string";
    }
  }
  if (
    (options.type === "string" || options.type === "alioss") &&
    !options.maxlength
  ) {
    options.maxlength = DEFAULT_STRING_MAXLENGTH;
  }
  let fcls = Field[options.type];
  if (!fcls) {
    throw new Error("invalid field type:" + options.type);
  }
  return fcls.new(options);
}
const baseModel = {
  abstract: true,
  fieldNames: ["id", "ctime", "utime"],
  fields: {
    id: { type: "integer", primaryKey: true, serial: true },
    ctime: { label: "创建时间", type: "datetime", autoNowAdd: true },
    utime: { label: "更新时间", type: "datetime", autoNow: true },
  },
};
function checkReserved(name) {
  assert(typeof name === "string", `name must by string, not ${typeof name} (${name})`);
  assert(!name.includes("__"), "don't use __ in a field name");
  assert(!IS_PG_KEYWORDS[name.toUpperCase()], `${name} is a postgresql reserved word`);
}
function normalizeArrayAndHashFields(fields) {
  assert(typeof fields === "object", "you must provide fields for a model");
  let alignedFields = {};
  for (let [name, field] of Object.entries(fields)) {
    if (typeof name === "number") {
      assert(
        field.name,
        "you must define name for a field when using array fields"
      );
      alignedFields[field.name] = field;
    } else {
      alignedFields[name] = field;
    }
  }
  return alignedFields;
}
function normalizeFieldNames(fieldNames) {
  assert(
    typeof fieldNames === "object",
    "you must provide field_names for a model"
  );
  for (let name of fieldNames) {
    assert(typeof name === "string", "element of field_names must be string");
  }
  return fieldNames;
}
function isFieldClass(t) {
  return t instanceof Sql || t instanceof Modelsql
}

class ValidateError extends Error {
  constructor({ name, message, label, httpCode }) {
    super(message)
    Object.assign(this, { name, label, httpCode, message })
  }
}
class ValidateBatchError extends ValidateError {
  constructor({ name, message, label, httpCode, index }) {
    super({ name, message, label, httpCode })
    this.index = index
  }
  toString() {
    return `FIELD ERROR: ${this.name}(${this.label})+${this.message}`
  }
}
function checkUpsertKey(rows, key) {
  assert(key, "no key for upsert");
  if (rows instanceof Array) {
    if (typeof key === "string") {
      for (let [i, row] of rows.entries()) {
        if (row[key] === undefined || row[key] === "") {
          throw new ValidateBatchError({
            message: "value of key is required for upsert/merge",
            index: i,
            name: key,
          });
        }
      }
    } else {
      for (let row of rows) {
        let emptyKeys = true;
        for (let k of key) {
          if (!(row[k] === undefined || row[k] === "")) {
            emptyKeys = false;
            break;
          }
        }
        if (emptyKeys) {
          throw new Error("empty keys for upsert");
        }
      }
    }
  } else if (typeof key === "string") {
    if (rows[key] === undefined || rows[key] === "") {
      throw new ValidateError({ name: key, message: "value of key is required" });
    }
  } else {
    for (let [_, k] of key.entries()) {
      if (rows[k] === undefined || rows[k] === "") {
        throw new ValidateError({ name: k, message: "value of key is required" });
      }
    }
  }
  return [rows, key];
}
function makeRecordClass(model, cls) {
  class Record {
    constructor(data) {
      return Object.assign(this, data);
    }
    async delete(key) {
      key = key || model.primaryKey;
      return await cls.delete({ [key]: this[key] }).exec();
    }
    async save(names, key) {
      return await cls.save(this, names, key);
    }
    async saveCreate(names, key) {
      return await cls.saveCreate(this, names, key);
    }
    async saveUpdate(names, key) {
      return await cls.saveUpdate(this, names, key);
    }
    async saveFrom(key) {
      return await cls.saveFrom(this, key);
    }
    async createFrom(key) {
      return await cls.createFrom(this, key);
    }
    async updateFrom(key) {
      return await cls.updateFrom(this, key);
    }
    validate(names, key) {
      return cls.validate(this, names, key);
    }
    validateUpdate(names) {
      return cls.validateUpdate(this, names);
    }
    validateCreate(names) {
      return cls.validateCreate(this, names);
    }
  }
  return Record
}


class Model {
  static ValidateError = ValidateError;
  static ValidateBatchError = ValidateBatchError
  static baseModel = baseModel;
  static makeFieldFromJson = makeFieldFromJson;
  static makeClass(options) {
    return this.makeModelClass(this.normalize(options));
  }
  static async query(statement) {
    throw new Error("you must implement query method")
  }
  static normalize(options) {
    assert(typeof options === "object", "model must be a table");
    let _extends = options.extends;
    let model = {};
    let optsFields = normalizeArrayAndHashFields(options.fields || {});
    let optsNames = options.fieldNames;
    if (!optsNames) {
      optsNames = Object.keys(optsFields);
    }
    model.fieldNames = normalizeFieldNames([...optsNames]);
    model.fields = {};
    for (let name of optsNames) {
      checkReserved(name);
      if (false) {
        throw new Error(
          `field name "${name}" conflicts with model class attributes`
        );
      }
      let field = optsFields[name];
      if (!field) {
        let tname = options.tableName || "[abstract model]";
        if (_extends) {
          field = _extends.fields[name];
          if (!field) {
            throw new Error(
              `'${tname}' field name '${name}' is not in fields and parent fields`
            );
          }
        } else {
          throw new Error(`'${tname}' field name '${name}' is not in fields`);
        }
      } else if (!isFieldClass(field)) {
        if (_extends) {
          let pfield = _extends.fields[name];
          if (pfield) {
            field = { ...pfield.getOptions(), ...field };
            if (pfield.model && field.model) {
              field.model = this.makeClass({
                abstract: true,
                extends: pfield.model,
                fields: field.model.fields,
                fieldNames: field.model.fieldNames,
              });
            }
          }
        } else {
        }
      } else {
      }
      if (!isFieldClass(field)) {
        model.fields[name] = makeFieldFromJson(field, { name });
      } else {
        model.fields[name] = makeFieldFromJson(field.getOptions(), {
          name: name,
          type: field.type,
        });
      }
    }
    for (let [key, value] of Object.entries(options)) {
      if (model[key] === undefined && !nonMergeNames[key]) {
        model[key] = value;
      }
    }
    let abstract;
    if (options.abstract !== undefined) {
      abstract = !!options.abstract;
    } else {
      abstract = options.tableName === undefined;
    }
    model.abstract = abstract;
    model.__normalized__ = true;
    if (options.mixins) {
      return this.mergeModels(options.mixins + [model]);
    } else {
      return model;
    }
  }
  static makeModelClass(model) {
    class ConcreteModel extends this {

    }
    Object.defineProperty(ConcreteModel, 'name', { value: `${model.tableName.toUpperCase()}Model` });
    let notAbstract = !model.abstract;
    if (notAbstract) {
      if (!model.tableName) {
        let namesHint =
          (model.fieldNames && model.fieldNames.join(",")) ||
          "no field_names";
        throw new Error(
          `you must define table_name for a non-abstract model (${namesHint})`
        );
      }
      checkReserved(model.tableName);
    }
    let pkDefined = false;
    model.foreignKeys = {};
    model.names = [];
    for (let [name, field] of Object.entries(model.fields)) {
      let fkModel = field.reference;
      if (fkModel === "self") {
        fkModel = ConcreteModel;
        field.reference = ConcreteModel;
      }
      if (fkModel) {
        model.foreignKeys[name] = field;
      }
      if (field.primaryKey) {
        let pkName = field.name;
        assert(
          !pkDefined,
          `duplicated primary key: "${pkName}" and "${pkDefined}"`
        );
        pkDefined = pkName;
        model.primaryKey = pkName;
      } else if (field.autoNow) {
        model.autoNowName = field.name;
      } else if (field.autoNowAdd) {
      } else {
        model.names.push(name);
      }
    }
    if (notAbstract && !pkDefined && !model.disableAutoPrimaryKey) {
      let pkName = model.defaultPrimaryKey || "id";
      model.primaryKey = pkName;
      model.fields[pkName] = Field.integer.new({
        name: pkName,
        primaryKey: true,
        serial: true,
      });
      model.fieldNames.unshift(pkName);
    }
    if (notAbstract && !model.Sql && modelReadyForSql(model)) {
      model.Sql = Modelsql.makeClass({
        model: ConcreteModel,
        tableName: model.tableName,
      });
    }
    if (notAbstract) {
      model.nameCache = {};
    }
    model.labelToName = {};
    model.nameToLabel = {};
    for (let [name, field] of Object.entries(model.fields)) {
      model.labelToName[field.label] = name;
      model.nameToLabel[name] = field.label;
      if (notAbstract) {
        model.nameCache[name] = model.tableName + ("." + name);
      }
      if (field.dbType === Field.basefield.NOT_DEFIEND) {
        field.dbType = model.fields[field.referenceColumn].dbType;
      }
    }
    if (!model.abstract) {
      model.Record = makeRecordClass(model, ConcreteModel);
    }
    ConcreteModel.Sql = model.Sql
    ConcreteModel.Record = model.Record
    ConcreteModel.query = model.query
    ConcreteModel.abstract = model.abstract
    ConcreteModel.disableAutoPrimaryKey = model.disableAutoPrimaryKey
    ConcreteModel.defaultPrimaryKey = model.defaultPrimaryKey || 'id'
    ConcreteModel.tableName = model.tableName
    ConcreteModel.fieldNames = model.fieldNames
    ConcreteModel.fields = model.fields
    ConcreteModel.foreignKeys = model.foreignKeys
    ConcreteModel.names = model.names
    ConcreteModel.primaryKey = model.primaryKey
    ConcreteModel.autoNowName = model.autoNowName
    ConcreteModel.nameCache = model.nameCache
    ConcreteModel.labelToName = model.labelToName
    ConcreteModel.nameToLabel = model.nameToLabel
    return ConcreteModel
  }
  static mixWithBase(...varargs) {
    return this.mix(baseModel, ...varargs);
  }
  static mix(...varargs) {
    let models = [...varargs];
    if (models.length === 1) {
      return this.makeClass(models[0]);
    } else if (models.length > 1) {
      return this.makeModelClass(this.mergeModels(models));
    } else {
      throw new Error("empty mixins passed to model.mix");
    }
  }
  static mergeModels(models) {
    return models.reduce((a, b) => this.mergeModel(a, b));
  }
  static mergeModel(a, b) {
    let A = (a.__normalized__ && a) || this.normalize(a);
    let B = (b.__normalized__ && b) || this.normalize(b);
    let C = {};
    let fieldNames = (A.fieldNames + B.fieldNames).filter(unique);
    let fields = {};
    for (let name of fieldNames) {
      let aField = A.fields[name];
      let bField = B.fields[name];
      if (aField && bField) {
        fields[name] = this.mergeField(aField, bField);
      } else if (aField) {
        fields[name] = aField;
      } else {
        fields[name] = bField;
      }
    }
    for (let M of [A, B]) {
      for (let [key, value] of Object.entries(M)) {
        if (!nonMergeNames[key]) {
          C[key] = value;
        }
      }
    }
    C.fieldNames = fieldNames;
    C.fields = fields;
    return this.normalize(C);
  }
  static mergeField(a, b) {
    let aopts = (a instanceof Field && a.getOptions()) || { ...a };
    let bopts = (b instanceof Field && b.getOptions()) || { ...b };
    let options = { ...aopts, ...bopts };
    if (aopts.model && bopts.model) {
      options.model = this.makeModelClass(this.mergeModel(aopts.model, bopts.model))
    }
    return makeFieldFromJson(options);
  }
  static new(attrs) {
    return new this.Record(attrs);
  }
  static async all() {
    let records = await this.query("SELECT * FROM " + this.tableName);
    for (let i = 0; i < records.length; i = i + 1) {
      records[i] = this.load(records[i]);
    }
    return records;
  }
  static async save(input, names, key) {
    key = key || this.primaryKey;
    if (input[key] !== undefined) {
      return await this.saveUpdate(input, names, key);
    } else {
      return await this.saveCreate(input, names, key);
    }
  }
  static async saveCreate(input, names, key) {
    let data = this.validateCreate(input, names);
    return await this.createFrom(data, key);
  }
  static async saveUpdate(input, names, key) {
    let data = this.validateUpdate(input, names);
    key = key || this.primaryKey;
    data[key] = input[key];
    return await this.updateFrom(data, key);
  }
  static async saveFrom(data, key) {
    key = key || this.primaryKey;
    if (data[key] !== undefined) {
      return await this.updateFrom(data, key);
    } else {
      return await this.createFrom(data, key);
    }
  }
  static async createFrom(data, key) {
    key = key || this.primaryKey;
    let prepared = this.prepareForDb(data);
    let created = await Sql.prototype
      .insert.call(this.Sql.new(), prepared)
      .returning(key)
      .execr();
    data[key] = created[0][key];
    return this.new(data);
  }
  static async updateFrom(data, key) {
    key = key || this.primaryKey;
    let prepared = this.prepareForDb(data, undefined, true);
    let lookValue = assert(data[key], "no key provided for update");
    let updateResult = await Sql.prototype
      .update.call(this.Sql.new(), prepared)
      .where({ [key]: lookValue })
      .returning(key)
      .execr();
    if (updateResult.length === 1) {
      return this.new(data);
    } else if (updateResult.length === 0) {
      throw new Error(
        `update failed, record does not exist(model:${this.tableName}, key:${key}, value:${lookValue})`
      );
    } else {
      throw new Error(
        `not 1 record are updated(model:${this.tableName}, key:${key}, value:${lookValue})`
      );
    }
  }
  static prepareForDb(data, columns, isUpdate) {
    let prepared = {};
    for (let name of (columns || this.names)) {
      let field = this.fields[name];
      if (!field) {
        throw new Error(
          `invalid field name '${name}' for model '${this.tableName}'`
        );
      }
      let value = data[name];
      if (field.prepareForDb && value !== undefined) {
        try {
          let val = field.prepareForDb(value, data);
          prepared[name] = val;
        } catch (error) {
          throw new ValidateError({ name: name, message: error.message, label: field.label });
        }
      } else {
        prepared[name] = value;
      }
    }
    if (isUpdate && this.autoNowName) {
      prepared[this.autoNowName] = getLocalTime();
    }
    return prepared;
  }
  static validate(input, names, key) {
    if (input === true || input === false) {
      return this.Sql.new().validate(input);
    } else if (input[key || this.primaryKey]) {
      return this.validateUpdate(input, names);
    } else {
      return this.validateCreate(input, names);
    }
  }
  static validateCreate(input, names) {
    let data = {}
    let value
    for (let name of (names || this.names)) {
      let field = this.fields[name];
      if (!field) {
        throw new Error(
          `invalid field name '${name}' for model '${this.tableName}'`
        );
      }
      try {
        value = field.validate(input[name], input);
      } catch (error) {
        throw new ValidateError({
          name: name,
          message: error.message,
          label: field.label,
          httpCode: 422,
        });
      }
      if (field.default && (value === undefined || value === "")) {
        if (typeof field.default !== "function") {
          value = field.default;
        } else {
          try {
            value = field.default(input);
          } catch (error) {
            throw new Error({
              name: name,
              message: error.message,
              label: field.label,
              httpCode: 422,
            });
          }
        }
      }
      data[name] = value;
    }
    if (!this.clean) {
      return data;
    } else {
      return this.clean(data);
    }
  }
  static validateUpdate(input, names) {
    let data = {};
    let value
    for (let name of (names || this.names)) {
      let field = this.fields[name];
      if (!field) {
        throw new Error(
          `invalid field name '${name}' for model '${this.tableName}'`
        );
      }
      value = input[name];
      if (value !== undefined) {
        try {
          value = field.validate(input[name], input);
          if (value === undefined) {
            data[name] = "";
          } else {
            data[name] = value;
          }
        } catch (error) {
          throw new ValidateError({
            name: name,
            message: error.message,
            label: field.label,
            httpCode: 422,
          });
        }
      }
    }
    if (!this.clean) {
      return data;
    } else {
      return this.clean(data);
    }
  }
  static validateCreateData(rows, columns) {
    let cleaned;
    columns = columns || this.Sql.prototype._getKeys(rows);
    if (rows instanceof Array) {
      cleaned = [];
      for (let [index, row] of rows.entries()) {
        try {
          cleaned[index] = this.validateCreate(row, columns);;
        } catch (error) {
          if (error instanceof ValidateError) {
            throw new ValidateBatchError({ ...error, index, message: error.message })
          } else {
            throw error
          }
        }
      }
    } else {
      cleaned = this.validateCreate(rows, columns);
    }
    return [cleaned, columns];
  }
  static validateUpdateData(rows, columns) {
    let cleaned;
    columns = columns || this.Sql.prototype._getKeys(rows);
    if (rows instanceof Array) {
      cleaned = []
      for (let [index, row] of rows.entries()) {
        try {
          cleaned[index] = this.validateUpdate(row, columns);;
        } catch (error) {
          if (error instanceof ValidateError) {
            throw new ValidateBatchError({ ...error, index })
          } else {
            throw error
          }
        }
      }
    } else {
      cleaned = this.validateUpdate(rows, columns);
    }
    return [cleaned, columns];
  }
  static validateCreateRows(rows, key, columns) {
    [rows, key] = checkUpsertKey(rows, key || this.primaryKey);
    [rows, columns] = this.validateCreateData(rows, columns);
    return [rows, key, columns];
  }
  static validateUpdateRows(rows, key, columns) {
    [rows, key] = checkUpsertKey(rows, key || this.primaryKey);
    [rows, columns] = this.validateUpdateData(rows, columns);
    return [rows, key, columns];
  }
  static prepareDbRows(rows, columns, isUpdate) {
    let cleaned;
    columns = columns || this.Sql.prototype._getKeys(rows);
    if (rows instanceof Array) {
      cleaned = [];
      for (let [i, row] of rows.entries()) {
        cleaned[i] = this.prepareForDb(row, columns, isUpdate);;
      }
    } else {
      cleaned = this.prepareForDb(rows, columns, isUpdate);
    }
    if (isUpdate) {
      let utime = this.autoNowName;
      if (utime && !columns.includes(utime)) {
        columns.push(utime);
      }
      return [cleaned, columns];
    } else {
      return [cleaned, columns];
    }
  }
  static load(data) {
    for (let name of this.names) {
      let field = this.fields[name];
      let value = data[name];
      if (value !== undefined) {
        if (!field.load) {
          data[name] = value;
        } else {
          data[name] = field.load(value);
        }
      }
    }
    return this.new(data);
  }
  static raw() {
    return this.Sql.new().raw();
  }
  static count(...varargs) {
    return this.Sql.new().count(...varargs);
  }
  static commit(bool) {
    return this.Sql.new().commit(bool);
  }
  static withValues(name, rows) {
    return this.Sql.new().withValues(name, rows);
  }
  static async upsert(rows, key, columns) {
    return await this.Sql.new().upsert(rows, key, columns);
  }
  static async merge(rows, key, columns) {
    return await this.Sql.new().merge(rows, key, columns);
  }
  static async updates(rows, key, columns) {
    return await this.Sql.new().updates(rows, key, columns);
  }
  static async gets(keys) {
    return await this.Sql.new().gets(keys);
  }
  static async mergeGets(rows, keys) {
    return await this.Sql.new().mergeGets(rows, keys);
  }
  static async filter(kwargs) {
    return await this.Sql.new().filter(kwargs);
  }
  static async get(...varargs) {
    return await this.Sql.new().get(...varargs);
  }
  static async getOrCreate(...varargs) {
    return await this.Sql.new().getOrCreate(...varargs);
  }
  static insert(...varargs) {
    return this.Sql.new().insert(...varargs);
  }
  static update(...varargs) {
    return this.Sql.new().update(...varargs);
  }
  static loadFk(...varargs) {
    return this.Sql.new().loadFk(...varargs);
  }
  static compact() {
    return this.Sql.new().compact();
  }
  static flat(depth) {
    return this.Sql.new().flat(depth);
  }
  static with(...varargs) {
    return this.Sql.new().with(...varargs);
  }
  static as(name) {
    return this.Sql.new().as(name);
  }
  static delete(...varargs) {
    return this.Sql.new().delete(...varargs);
  }
  static using(...varargs) {
    return this.Sql.new().using(...varargs);
  }
  static select(...varargs) {
    return this.Sql.new().select(...varargs);
  }
  static from(...varargs) {
    return this.Sql.new().from(...varargs);
  }
  static returning(...varargs) {
    return this.Sql.new().returning(...varargs);
  }
  static join(...varargs) {
    return this.Sql.new().join(...varargs);
  }
  static leftJoin(...varargs) {
    return this.Sql.new().leftJoin(...varargs);
  }
  static rightJoin(...varargs) {
    return this.Sql.new().rightJoin(...varargs);
  }
  static fullJoin(...varargs) {
    return this.Sql.new().fullJoin(...varargs);
  }
  static group(...varargs) {
    return this.Sql.new().group(...varargs);
  }
  static groupBy(...varargs) {
    return this.Sql.new().groupBy(...varargs);
  }
  static order(...varargs) {
    return this.Sql.new().order(...varargs);
  }
  static orderBy(...varargs) {
    return this.Sql.new().orderBy(...varargs);
  }
  static limit(n) {
    return this.Sql.new().limit(n);
  }
  static offset(n) {
    return this.Sql.new().offset(n);
  }
  static where(...varargs) {
    return this.Sql.new().where(...varargs);
  }
  static whereOr(...varargs) {
    return this.Sql.new().whereOr(...varargs);
  }
  static orWhereOr(...varargs) {
    return this.Sql.new().orWhereOr(...varargs);
  }
  static whereNot(...varargs) {
    return this.Sql.new().whereNot(...varargs);
  }
  static whereExists(builder) {
    return this.Sql.new().whereExists(builder);
  }
  static whereNotExists(builder) {
    return this.Sql.new().whereNotExists(builder);
  }
  static whereIn(cols, range) {
    return this.Sql.new().whereIn(cols, range);
  }
  static whereNotIn(cols, range) {
    return this.Sql.new().whereNotIn(cols, range);
  }
  static whereNull(col) {
    return this.Sql.new().whereNull(col);
  }
  static whereNotNull(col) {
    return this.Sql.new().whereNotNull(col);
  }
  static whereBetween(col, low, high) {
    return this.Sql.new().whereBetween(col, low, high);
  }
  static whereNotBetween(col, low, high) {
    return this.Sql.new().whereNotBetween(col, low, high);
  }
  static whereRaw(token) {
    return this.Sql.new().whereRaw(token);
  }
  static orWhere(...varargs) {
    return this.Sql.new().orWhere(...varargs);
  }
  static orWhereNot(...varargs) {
    return this.Sql.new().orWhereNot(...varargs);
  }
  static orWhereExists(builder) {
    return this.Sql.new().orWhereExists(builder);
  }
  static orWhereNotExists(builder) {
    return this.Sql.new().orWhereNotExists(builder);
  }
  static orWhereIn(cols, range) {
    return this.Sql.new().orWhereIn(cols, range);
  }
  static orWhereNotIn(cols, range) {
    return this.Sql.new().orWhereNotIn(cols, range);
  }
  static orWhereNull(col) {
    return this.Sql.new().orWhereNull(col);
  }
  static orWhereNotNull(col) {
    return this.Sql.new().orWhereNotNull(col);
  }
  static orWhereBetween(col, low, high) {
    return this.Sql.new().orWhereBetween(col, low, high);
  }
  static orWhereNotBetween(col, low, high) {
    return this.Sql.new().orWhereNotBetween(col, low, high);
  }
  static orWhereRaw(token) {
    return this.Sql.new().orWhereRaw(token);
  }
  static having(...varargs) {
    return this.Sql.new().having(...varargs);
  }
  static havingNot(...varargs) {
    return this.Sql.new().havingNot(...varargs);
  }
  static havingExists(builder) {
    return this.Sql.new().havingExists(builder);
  }
  static havingNotExists(builder) {
    return this.Sql.new().havingNotExists(builder);
  }
  static havingIn(cols, range) {
    return this.Sql.new().havingIn(cols, range);
  }
  static havingNotIn(cols, range) {
    return this.Sql.new().havingNotIn(cols, range);
  }
  static havingNull(col) {
    return this.Sql.new().havingNull(col);
  }
  static havingNotNull(col) {
    return this.Sql.new().havingNotNull(col);
  }
  static havingBetween(col, low, high) {
    return this.Sql.new().havingBetween(col, low, high);
  }
  static havingNotBetween(col, low, high) {
    return this.Sql.new().havingNotBetween(col, low, high);
  }
  static havingRaw(token) {
    return this.Sql.new().havingRaw(token);
  }
  static orHaving(...varargs) {
    return this.Sql.new().orHaving(...varargs);
  }
  static orHavingNot(...varargs) {
    return this.Sql.new().orHavingNot(...varargs);
  }
  static orHavingExists(builder) {
    return this.Sql.new().orHavingExists(builder);
  }
  static orHavingNotExists(builder) {
    return this.Sql.new().orHavingNotExists(builder);
  }
  static orHavingIn(cols, range) {
    return this.Sql.new().orHavingIn(cols, range);
  }
  static orHavingNotIn(cols, range) {
    return this.Sql.new().orHavingNotIn(cols, range);
  }
  static orHavingNull(col) {
    return this.Sql.new().orHavingNull(col);
  }
  static orHavingNotNull(col) {
    return this.Sql.new().orHavingNotNull(col);
  }
  static orHavingBetween(col, low, high) {
    return this.Sql.new().orHavingBetween(col, low, high);
  }
  static orHavingNotBetween(col, low, high) {
    return this.Sql.new().orHavingNotBetween(col, low, high);
  }
  static orHavingRaw(token) {
    return this.Sql.new().orHavingRaw(token);
  }
}

export default Model;