import { readFileSync } from "fs";

const Ajv = require('ajv');
const ajv = new Ajv();

export class JsonParameterSchema<T> {
    private ajvSchema: any;

    constructor(ajvSchemaJson: any) {
        this.ajvSchema = ajv.compile(ajvSchemaJson);
    }

    load(filename: string): T {
        const parameters = JSON.parse(readFileSync(filename).toString());
        return this.validate(parameters);
    }

    validate(parameters: unknown): T {
        if (this.ajvSchema(parameters)) {
            return parameters as T;
        }
        throw new Error(`Invalid format of parameter file`);
    }
}
