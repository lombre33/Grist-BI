// Licensed to the Apache Software Foundation (ASF) under one
// or more contributor license agreements.  See the NOTICE file
// distributed with this work for additional information
// regarding copyright ownership.  The ASF licenses this file
// to you under the Apache License, Version 2.0 (the
// "License"); you may not use this file except in compliance
// with the License.  You may obtain a copy of the License at
//
//   http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
// KIND, either express or implied.  See the License for the
// specific language governing permissions and limitations
// under the License.
/**
 * Grist-BI : version modifiée de ce fichier (voir js/vendor/SOURCES.md, « Modifications »).
 * L'original compile les valeurs nulles en une fonction `switch` par le constructeur `Function`, ce qu'une politique de sécurité
 * de contenu sans `unsafe-eval` refuse et qu'aucun audit de widget n'accepte. Même contrat, sans compilation de code :
 * `isValid(x)` rend `false` pour une valeur nulle (comparaison stricte `===`, NaN compris), `true` sinon.
 *
 * @ignore
 * @param nullValues
 */
export function createIsValidFunction(nullValues) {
    if (!nullValues || nullValues.length <= 0) {
        // @ts-ignore
        return function isValid(value) { return true; };
    }
    // NaN ne vaut jamais NaN : il se teste à part, comme dans l'original. Un `Set` compare comme `===` pour tout le reste
    // (null, undefined, nombres, bigints, chaînes) et traite 0 et -0 pareil, comme un `switch`.
    const hasNaN = nullValues.some((x) => x !== x);
    const nulls = new Set(nullValues.filter((x) => x === x));
    return function isValid(x) {
        if (hasNaN && x !== x) {
            return false;
        }
        return !nulls.has(x);
    };
}
//# sourceMappingURL=valid.mjs.map
