import { StreamUtil } from './StreamUtil';
import { MetaBase } from './MetaTypes';
import { MetaPage } from './MetaPage';

export class Metafile extends MetaBase {
    public pages:MetaPage[] = [];
    public LoadFromStream(astream:ArrayBuffer)
    {

    }
}
