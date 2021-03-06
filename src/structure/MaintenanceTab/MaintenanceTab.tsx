import React from 'react';
import styles from './MaintenanceTab.scss';
import schemas from 'part:@sanity/base/schema';
import classNames from 'classnames';
import { getConfig, getSanityClient, getLanguageFromId, makeObjectKey, getSchema, getBaseIdFromId, buildDocId } from '../../utils';
import { ChevronDown } from './ChevronDown';
import { SanityDocument } from '@sanity/client';
import { Ti18nSchema } from '../../types';
import { I18nPrefix } from '../../constants';

type Ti18nDocument = SanityDocument<any>;

interface IProps {
}

interface IState {
  pending: boolean;
  selectedSchema: string;
  documents: Ti18nDocument[];
}

export class MaintenanceTab extends React.Component<IProps, IState> {
  private _sanityClient = getSanityClient();
  public state: IState = {
    pending: false,
    selectedSchema: '',
    documents: [],
  }

  public get i18nSchemas() { return schemas._original.types.filter(s => !!s.i18n); }
  public get baseDocuments() { return this.state.documents.filter(d => !d._id.startsWith(I18nPrefix)); }
  public get translatedDocuments() { return this.state.documents.filter(d => d._id.startsWith(I18nPrefix)); }
  public get oldIdDocuments() { return this.state.documents.filter(d => d._id.includes('__i18n_')); }
  public get documentsSummaryInformation() {
    const { documents, selectedSchema } = this.state;
    const config = getConfig(selectedSchema);
    const basedocuments = this.baseDocuments;
    const translateddocuments = this.translatedDocuments;
    const oldiddocuments = this.oldIdDocuments;
    const refsFieldName = config.fieldNames?.references;
    const langFieldName = config.fieldNames?.lang;
    return {
      oldIdStructure: oldiddocuments,
      missingLanguageField: documents.filter(d => !d[langFieldName]),
      missingDocumentRefs: basedocuments.filter((d) => {
        const docs = translateddocuments.filter(dx => getBaseIdFromId(dx._id) === d._id);
        const refsCount = Object.keys(d[refsFieldName] || {}).length;
        return refsCount != docs.length;
      }),
      orphanDocuments: translateddocuments.filter(d => {
        const base = basedocuments.find(doc => getBaseIdFromId(d._id) === doc._id);
        if (base) return false;
        return true;
      })
    };
  }

  protected fetchInformation = async () => {
    const { selectedSchema } = this.state;
    this.setState({ pending: true });
    const result = await this._sanityClient.fetch<Ti18nDocument[]>('*[_type == $type]', { type: selectedSchema });
    this.setState({ pending: false, documents: result });
  }

  protected fixOldIdDocuments = async () => {
    this.setState({ pending: true });
    const { selectedSchema } = this.state;
    const config = getConfig();
    const refsFieldName = config.fieldNames.references;
    const oldIdDocuments = this.oldIdDocuments;
    await Promise.all(oldIdDocuments.map(async d => {
      const baseId = getBaseIdFromId(d._id);
      const lang = getLanguageFromId(d._id);
      const newId = buildDocId(baseId, lang);
      const transaction = this._sanityClient.transaction()
      transaction.createIfNotExists({
        ...d,
        _id: newId,
        _type: selectedSchema,
      });
      transaction.delete(d._id);
      await transaction.commit();
      await this._sanityClient.patch(baseId)
      .setIfMissing({ [refsFieldName]: [] })
      .append(refsFieldName, [{
        _key: newId,
        lang: lang,
        ref: {
          _type: 'reference',
          _ref: newId,
        }
      }]).commit();
    }));
    await this.fetchInformation();
  }

  protected fixLanguageFields = async () => {
    this.setState({ pending: true });
    const { documents, selectedSchema } = this.state;
    const config = getConfig(selectedSchema);
    const langFieldName = config.fieldNames?.lang;
    await Promise.all(documents.map(async d => {
      const schema = getSchema<Ti18nSchema>(d._type);
      const base = ((typeof schema.i18n === 'object') ? schema.i18n.base : undefined) || config.base;
      if (!d[langFieldName]) {
        const language = getLanguageFromId(d._id) || base;
        await this._sanityClient.patch(d._id, {
          set: {
            [langFieldName]: language,
          },
        }).commit();
      }
    }));
    this.fetchInformation();
  }

  protected fixTranslationRefs = async () => {
    this.setState({ pending: true });
    const { selectedSchema } = this.state;
    const config = getConfig(selectedSchema);
    const refsFieldName = config.fieldNames.references;
    const translatedDocuments = this.translatedDocuments;
    await Promise.all(this.baseDocuments.map(async d => {
      const docs = translatedDocuments.filter(dx => getBaseIdFromId(dx._id) === d._id);
      const refsCount = Object.keys(d[refsFieldName] || {}).length;
      if (refsCount != docs.length) {
        await this._sanityClient.patch(d._id, {
          set: {
            [refsFieldName]: translatedDocuments.map((doc) => {
              const lang = getLanguageFromId(doc._id);
              return {
                _key: doc._id,
                lang,
                ref: {
                  _type: 'reference',
                  _ref: doc._id,
                }
              };
            }, {})
          },
        }).commit();
      }
    }));
    this.fetchInformation();
  }

  protected fixOrphanedDocuments = async () => {
    this.setState({ pending: true });
    const basedocuments = this.baseDocuments;
    await Promise.all(this.translatedDocuments.map(async d => {
      const base = basedocuments.find(doc => d._id.startsWith(doc._id));
      if (!base) await this._sanityClient.delete(d._id);
    }));
    this.fetchInformation();
  }

  public onSchemaTypeChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const schemaType = event.currentTarget.value;
    this.setState({
      selectedSchema: schemaType,
      pending: true,
    }, this.fetchInformation);
  }

  public render() {
    const { pending, selectedSchema, documents } = this.state;
    const config = getConfig();
    const info = this.documentsSummaryInformation;

    return (
      <div
        className={classNames({
          [styles.root]: true,
          [styles.disabled]: pending,
        })}
      >
        <div className={styles.schemaselect}>
          <select onChange={this.onSchemaTypeChange} value={selectedSchema}>
            <option selected disabled value="">{config.messages?.translationsMaintenance?.selectSchemaPlaceholder}</option>
            {this.i18nSchemas.map(s => (
              <option key={s.name} value={s.name}>
                {s.title}
              </option>
            ))}
          </select>
          <ChevronDown />
        </div>
        {(!!selectedSchema) && (
          <div
            className={styles.dashboard}
          >
            <div className={styles.entry}>
              <p>{info.oldIdStructure.length} {config?.messages?.translationsMaintenance?.oldIdStructure}</p>
              {(info.oldIdStructure.length > 0) && (
                <button onClick={this.fixOldIdDocuments}>{config?.messages?.translationsMaintenance?.fix}</button>
              )}
            </div>
            <div className={styles.entry}>
              <p>{info.missingLanguageField.length} {config?.messages?.translationsMaintenance?.missingLanguageField}</p>
              {(info.missingLanguageField.length > 0) && (
                <button onClick={this.fixLanguageFields}>{config?.messages?.translationsMaintenance?.fix}</button>
              )}
            </div>
            <div className={styles.entry}>
              <p>{info.missingDocumentRefs.length} {config?.messages?.translationsMaintenance?.missingDocumentRefs}</p>
              {(info.missingDocumentRefs.length > 0) && (
                <button onClick={this.fixTranslationRefs}>{config?.messages?.translationsMaintenance?.fix}</button>
              )}
            </div>
            <div className={styles.entry}>
              <p>{info.orphanDocuments.length} {config?.messages?.translationsMaintenance?.orphanDocuments}</p>
              {(info.orphanDocuments.length > 0) && (
                <button onClick={this.fixOrphanedDocuments}>{config?.messages?.translationsMaintenance?.fix}</button>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }
}
