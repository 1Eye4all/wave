
import {combineLatest as observableCombineLatest, ReplaySubject, Subscription, BehaviorSubject, Observable} from 'rxjs';
import {tap, mergeMap, map} from 'rxjs/operators';
import {ChangeDetectionStrategy, Component, OnInit, OnDestroy, EventEmitter, Output} from '@angular/core';
import {CSVParameters, CsvSourceType} from '../../operators/types/csv-source-type.model';
import {Projection, Projections} from '../../operators/projection.model';
import {Operator} from '../../operators/operator.model';
import {UserService} from '../../users/user.service';
import {ProjectService} from '../../project/project.service';
import {RandomColorService} from '../../util/services/random-color.service';
import {MappingQueryService} from '../../queries/mapping-query.service';
import {MatDialog} from '@angular/material';
import {DataType, DataTypes} from '../../operators/datatype.model';
import {ResultTypes} from '../../operators/result-type.model';
import {VectorData, VectorLayer, RasterLayer} from '../../layers/layer.model';
import {WFSOutputFormats} from '../../queries/output-formats/wfs-output-format.model';
import {
    TextualAttributeFilterEngineType,
    TextualAttributeFilterType
} from '../../operators/types/textual-attribute-filter-type.model';
import {ComplexVectorSymbology} from '../../layers/symbology/symbology.model';
import {DataSource} from '@angular/cdk/collections';


function nameComparator(a: string, b: string): number {
    const stripped = (s: string): string => s.replace(' ', '');
    return stripped(a).localeCompare(stripped(b));
}

@Component({
    selector: 'wave-country-selection',
    templateUrl: 'country-selection.component.html',
    styleUrls: ['country-selection.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CountrySelectionComponent implements OnInit, OnDestroy {

    searchString$ = new BehaviorSubject<string>('');
    filteredEntries$ = new ReplaySubject<Array<CountryMapType>>(1);

    tableEntries: CountryDataSource;
    displayedColumns: Array<String> = ['name', 'area'];

    sourceIdColumn = 'NAME';
    sourceAreaColumn = 'AREA';

    isLoading$ = new BehaviorSubject(true);

    @Output() layer: EventEmitter<VectorLayer> = new EventEmitter();

    /*
    {
 		"filename": "file:///home/gfbio/data/dev/csv_source/country_borders.csv",
 		"on_error": "keep",
 		"separator": ",",
 		"geometry": "wkt",
 		"time": "none",
 		"columns": {
 			"x": "WKT",
 			"textual": ["FIPS", "ISO2", "ISO3", "UN", "NAME"],
 			"numeric": ["AREA", "POP2005", "REGION", "SUBREGION", "LON", "LAT"]
 		}
 	}
     */

    private sourceFile = 'file:///home/gfbio/data/dev/csv_source/country_borders.csv';
    private sourceParameters: CSVParameters = {
        header: 0,
        onError: 'keep',
        fieldSeparator: ',',
        geometry: 'wkt',
        time: 'none',
        columns: {
            x: 'WKT',
            textual: ['FIPS', 'ISO2', 'ISO3', 'UN', 'NAME'],
            numeric: ['AREA', 'POP2005', 'REGION', 'SUBREGION', 'LON', 'LAT'],
        },
        provenance: {
            citation: `TM_WORLD_BORDERS-0.1.ZIP

Provided by Bjorn Sandvik, thematicmapping.org

Use this dataset with care, as several of the borders are disputed.

The original shapefile (world_borders.zip, 3.2 MB) was downloaded from the Mapping Hacks website:
http://www.mappinghacks.com/data/

The dataset was derived by Schuyler Erle from public domain sources.
Sean Gilles did some clean up and made some enhancements.`,
            uri: '',
            license: 'Creative Commons Attribution-Share Alike License 3.0',
        },
    };
    private sourceProjection: Projection = Projections.WGS_84;
    private sourceOperator: Operator;
    private subscription: Subscription;


    constructor(private userService: UserService,
                private projectService: ProjectService,
                private randomColorService: RandomColorService,
                private mappingQueryService: MappingQueryService,
                public dialog: MatDialog) {
    }

    ngOnInit() {
        this.sourceOperator = this.createCsvSourceOperator();

        this.subscription = observableCombineLatest(
                this.getOperatorDataStream().pipe(map(
                    vectorData => {
                        // console.log('vectorData', vectorData);
                        const data = vectorData.data.map(olFeature => olFeature.getProperties() as { [k: string]: any });
                        // console.log('mapped', data);
                        return data;
                    }
                )),
                this.searchString$.pipe(map(searchString => searchString.toLowerCase())),
                (entries, searchString) => entries
                    .filter(entry => entry[this.sourceIdColumn].toString().toLowerCase().indexOf(searchString) >= 0)
                    .sort((a, b) => nameComparator(a[this.sourceIdColumn].toString(), b[this.sourceIdColumn].toString()))
            ).pipe(
            tap(() => this.isLoading$.next(false)))
            .subscribe(entries => this.filteredEntries$.next(entries));

        this.tableEntries = new CountryDataSource(this.filteredEntries$);
    }

    ngOnDestroy() {
        this.subscription.unsubscribe();
    }

    createCsvSourceOperator(): Operator {
        const csvSourceType = new CsvSourceType({
            dataURI: this.sourceFile,
            parameters: this.sourceParameters,
        });

        const dataTypes = new Map<string, DataType>();
        const attributes = new Array<string>();

        for (let an of this.sourceParameters.columns.numeric) {
            attributes.push(an);
            dataTypes.set(an, DataTypes.Float64); // TODO: get more accurate type
        }

        for (let an of this.sourceParameters.columns.textual) {
            attributes.push(an);
            dataTypes.set(an, DataTypes.Alphanumeric); // TODO: get more accurate type
        }

        const op = new Operator({
            operatorType: csvSourceType,
            resultType: ResultTypes.POLYGONS,
            projection: this.sourceProjection,
            attributes: attributes,
            dataTypes: dataTypes
        });

        return op;
    }

    getOperatorDataStream(): Observable<VectorData> {
        return this.projectService.getTimeStream().pipe(mergeMap(t => {
            return this.mappingQueryService.getWFSData({
                operator: this.sourceOperator,
                projection: this.sourceProjection,
                clustered: false,
                outputFormat: WFSOutputFormats.JSON,
                viewportSize: {
                    extent: this.sourceProjection.getExtent(),
                    resolution: 1,
                },
                time: t
            }).pipe(map(d => VectorData.olParse(t, this.sourceProjection, this.sourceProjection.getExtent(), d)));
        }));
    }

    createFilterOperator(key: string): Operator {
        const filterOperatorType = new TextualAttributeFilterType({
            attributeName: this.sourceIdColumn,
            engine: TextualAttributeFilterEngineType.EXACT,
            searchString: key,
        });

        const sourceOp = this.createCsvSourceOperator();

        return new Operator({
            operatorType: filterOperatorType,
            resultType: this.sourceOperator.resultType,
            projection: this.sourceOperator.projection,
            polygonSources: [sourceOp],
            attributes: sourceOp.attributes,
            dataTypes: sourceOp.dataTypes
        });
    }

    addLayer(name: string, operator: Operator) {
        let symbology = ComplexVectorSymbology.createSimpleSymbology({
            fillRGBA: this.randomColorService.getRandomColorRgba(),
        });

        const layer = new VectorLayer({
            name: name,
            operator: operator,
            symbology: symbology,
        });

        this.layer.emit(layer);
    }
}

interface CountryMapType {
    [key: string]: string | number
}

class CountryDataSource extends DataSource<CountryMapType> {
    private countries: Observable<Array<CountryMapType>>;

    constructor(countries: Observable<Array<CountryMapType>>) {
        super();
        this.countries = countries;
    }

    connect(): Observable<Array<CountryMapType>> {
        return this.countries;
    }

    disconnect() {
    }
}
