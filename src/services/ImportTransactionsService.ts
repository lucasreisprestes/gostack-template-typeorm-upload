import csvParse from 'csv-parse';
import fs from 'fs';
import {
  getCustomRepository,
  getRepository,
  In,
} from 'typeorm';

import TransactionRepository from '../repositories/TransactionsRepository';
import Category from '../models/Category';
import Transaction from '../models/Transaction';

interface CSVTransaction {
  title: string;
  type: 'income' | 'outcome';
  value: number;
  category: string;
}

class ImportTransactionsService {
  async execute(filePath: string): Promise<Transaction[]> {
    const transactionsRepository = getCustomRepository(TransactionRepository);
    const categoriesRepository = getRepository(Category);

    const contactsReadStream = fs.createReadStream(filePath);

    //ler a partir a segunda linha
    const parsers = csvParse({
      delimiter: ',',
      from_line: 2,
    });

    //Pipe vai lendo as linhas conforme for estiver disponível
    const parseCSV = contactsReadStream.pipe(parsers);

    const transactions: CSVTransaction[] = [];
    const categories: string[] = [];

    /**
     * Desestruturar!
     * Esta função não é assíncrona, será usado
     * uma promisses para aguardar o evento 'end'
     */
    parseCSV.on('data', async line => {
      const [title, type, value, category] = line.map((cell: string) =>
        cell.trim(),
      );

      if (!title || !type || !value) return;

      categories.push(category);
      transactions.push({ title, type, value, category });
    });

    //aguardar a finalização do processo
    await new Promise(resolve => parseCSV.on('end', resolve));

    //verificar se as categorias existem no bd
    const existentCategories = await categoriesRepository.find({
      where: {
        title: In(categories),
      },
    });

    //pegar somente o title das categorias existentes
    const existentCategoriesTitle = existentCategories.map(
      (category: Category) => category.title,
    );

    /*pegar as categorias que não existem no BD
    * logo verifica se não existe duplicada
    */
    const addCategoryTitles = categories
      .filter(category => !existentCategoriesTitle.includes(category))
      .filter((value, index, self) => self.indexOf(value) === index);

    //cria um array de json para inserir no bd
    const newCategories = categoriesRepository.create(
      addCategoryTitles.map(title => ({
        title,
      })),
    );

    await categoriesRepository.save(newCategories);

    const finalCategories = [...newCategories, ...existentCategories];

    const createdTransections = transactionsRepository.create(
      transactions.map(transaction => ({
        title: transaction.title,
        type: transaction.type,
        value: transaction.value,
        category: finalCategories.find(
          category => category.title === transaction.category,
        ),
      })),
    );

    await transactionsRepository.save(createdTransections);

    await fs.promises.unlink(filePath);

    return createdTransections;
  }
}

export default ImportTransactionsService;
