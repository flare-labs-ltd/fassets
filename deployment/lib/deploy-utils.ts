import { readFileSync } from "fs";
import { AssetManagerParameters } from "./asset-manager-parameters";

const Ajv = require('ajv');
const ajv = new Ajv();

const validateAssetManagerParameterSchema = ajv.compile(require('../config/asset-manager-parameters.schema.json'));

// Load parameters with validation against schema asset-manager-parameters.schema.json
export function loadAssetManagerParameters(filename: string): AssetManagerParameters {
    const jsonText = readFileSync(filename).toString();
    const parameters = JSON.parse(jsonText);
    return validateAssetManagerParameters(parameters);
}

export function validateAssetManagerParameters(parameters: unknown): AssetManagerParameters {
    if (validateAssetManagerParameterSchema(parameters)) {
        return parameters as AssetManagerParameters;
    }
    throw new Error(`Invalid format of parameter file`);
}
